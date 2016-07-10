#!/usr/bin/env node

/**

Usage:
node ItemImporter.js --help

-d 	dry run
-u  user id
-e  environment (prod, qa, dev, sandbox)
-f  items csv
-m  mappings json

Successful record identifiers are written to itemImport/success.json file
Errors are written to itemImport/output.json file

Example:
node ItemImporter.js -e prod -u 128 -f itemImport/item_bulk_mcq_v2.csv -m itemImport/mcq_mapping_v2.json

**/

var csv    = require('csv');
var fs     = require('fs');
var _      = require('underscore');
var async  = require('async');
var Client = require('node-rest-client').Client;
var cli    = require('cli');

/**
 * Command line options to the importer
 */
var options = cli.parse({
    dryrun:   ['d', 'Dry run (parse the items csv and print to console).'],
    user:     ['u', 'Your user id (will show in My Items view)', 'string'],
    env:      ['e', 'Environment', 'string', 'prod'],
    file:     ['f', 'Items csv file to process', 'file'],
    mapping:  ['m', 'Mapping json file', 'file', 'itemImport/mcq_mapping_v2.json'],
});

if ((!options.file) || (!options.env) || (!options.user)) {
    cli.error("Insufficient inputs.");
    cli.fatal("   [itemimporter --help] for usage help. ");
}

console.log();
console.log('----------------------------------------------------------------');
console.log("             Item Importer v2.0               ");
console.log('----------------------------------------------------------------');
console.log();

var client = new Client();

var API_ENDPOINT_PROD = "http://lp-sandbox.ekstep.org:8080/taxonomy-service/";
var API_ENDPOINT_SBX = "https://api.ekstep.org/learning-api/";
var API_ENDPOINT = (options.env == 'prod' ? API_ENDPOINT_PROD : API_ENDPOINT_SBX);
var CREATE_ITEM_URL = "/v1/assessmentitem/${id}";

var inputFilePath = options.file;
var mappingFile = options.mapping;

var mapping =  {};
var mappingJson = {};
var startRow = {};
var startCol = {};
var items = [];
var resultMap = {};
var errorMap = {};
var invalidCount = 0;
var calls = 0;

var default_qlevel = 'MEDIUM';


/**
 * Steps of execution
 */
async.waterfall([
	function(callback) {
		cli.info("Reading mapping file");
    	readMappings(callback);
    },
    function(arg1, callback) {
    	cli.info("Reading items csv");
    	importItems(callback);
    },
    function(arg1, callback) {
    	if (options.dryrun) {
    		console.log('----------------------------------------------------------------');
    		cli.info("Dry Run - Printing results");
    		printAssessmentItems(callback);
    	}
    	else {
    		cli.info("Loading " + items.length + " items");
    		createAssessmentItems(callback);
    		callback(null, "ok")
    	}
    }
], function (err, result) {
    if (err) {
		cli.error('Error: ' + err);
    }
});

// ################################################################################################
// Waterfall operations
// ################################################################################################

/**
 * Step 1 - Reads the mappings from mapping JSON file
 */
function readMappings(callback) {
	mapping = fs.readFileSync(mappingFile);
	mappingJson = JSON.parse(mapping);

	startRow = mappingJson['start_row'];
	startCol = mappingJson['start_col'];

	callback(null, 'ok');
}

/**
 * Step 2 - Parse the CSV to build item data for loading
 */
function importItems(callback) {
	csv()
	.from.stream(fs.createReadStream(inputFilePath))
	.on('record', function(row, index) {
		if (index >= startRow) {
			var item = {};
			getItemRecord(row, startCol, mappingJson.data, item);
			processItemRecord(row, item, index);
		}
	})
	.on('end', function(count){
		var countBefore = items.length;
		items = _.uniq(items, false, function(p){ return p.metadata.identifier;});
		var countAfter = items.length;
		var duplicates = countBefore - countAfter;

		cli.info("Parsed total " + (count - startRow) + " records, invalid records " + invalidCount + ", duplicates " + duplicates);
		callback(null, 'ok');
	})
	.on('error', function(error){
		cli.error('Import item error', error);
		callback('Import item error: ' + error);
	});
}

/**
 * Step 3 - DRY RUN - Prints item data to console
 */
function printAssessmentItems(callback) {
	if (items.length > 0) {
		var asyncFns = [];
		items.forEach(function(item) {
			var metadata = JSON.stringify(item.metadata);
			console.log(metadata);
		});
	}
}

/**
 * Step 3 - Actual - Makes the API calls to load the item data
 */
function createAssessmentItems(callback) {
	if (items.length > 0) {
		var asyncFns = [];


		console.log();

		items.forEach(function(item) {
			var metadata = item.metadata;
			asyncFns.push(getMWAPICallfunction(item));
		});
		if (asyncFns.length > 0) {
			async.parallelLimit(asyncFns,10,
				function (err, result) {
					if (err) {
						callback(err);
			    	} else {
			    		callback(null, 'ok');
			    	}
			    	finished(result);
			});
		} else {
			callback(null, 'ok');
		}
	} else {
		callback(null, 'ok');
	}
}

/**
 * Step 4 - Final summary - after all items are loaded, prints the summary
 */
function finished(result) {
	console.log();

	var successCount = 0;
	var errorCount = 0;

	if (resultMap) {
		successCount = _.keys(resultMap).length;
		if (successCount > 0) {
			cli.info('Successfully loaded ' + successCount + ' items. See itemImport/success.json for details');
			var fd = fs.openSync('itemImport/success.json', 'w');
			fs.writeSync(fd, JSON.stringify(resultMap));
			cli.info("Saved the results to itemImport/success.json");
		}
	}

	if (errorMap) {
		errorCount = _.keys(errorMap).length;
		if (errorCount > 0) {
			cli.error("Failed to create/update " + errorCount + " items");
			for (var e in errorMap) {
				cli.error('Row ' + e + ' -> ' + JSON.stringify(errorMap[e]));
			}

			var fd = fs.openSync('itemImport/output.json', 'w');
			fs.writeSync(fd, JSON.stringify(errorMap));
		}
	}

	console.log();
	console.log('----------------------------------------------------------------');
	if ((successCount > 0) && (errorCount == 0)) cli.ok('Completed! All items loaded successfully');
	else cli.error('Completed! There were errors. See the logs above for error descriotions');
	console.log('----------------------------------------------------------------');
	console.log();
}

// ################################################################################################
// Item data processing
// ################################################################################################

/**
 * Updates the item record that has been parsed from CSV, sets default fields, shuffles options.
 */
function processItemRecord(row, item, index) {
	// Default fields
	item['rownum'] = index;
	item['portalOwner'] = options.user;
	item['language'] =  [item['language']];
	item['name'] = item['title']; // name is same as title
	item['gradeLevel'] =  [item['gradeLevel']]; // value of grade level is an array

	if (isEmpty(item['identifier'])) {
		item['identifier'] = item['code'];
	}
	if (isEmpty(item['qlevel'])) {
		item['qlevel'] = default_qlevel;
	}

	if (item['type'] == 'ftb') {
		// TODO: Below code added to handle the no of answer issue since in CSV the 'num_answers' is not equals to no. of answers
		item['num_answers'] = getNumberOfKeys(item['answer']);
	}
	else if (item['type'] == 'mcq') {
		// De-dup and Shuffle options before loading
		item['options'] = processOptions(item['options']);;
	}
	else if (item['type'] == 'mtf') {
		// Shuffle RHS options (LHS options are not shuffled otherwise answer mappings will become wrong)
		item['lhs_options'] = processOptions(item['lhs_options'], false);
		item['rhs_options'] = processOptions(item['rhs_options'], true);
	}

	// Validate if the data is correct
	if (validateQuestion(item)) {
		items.push({'index': index, 'row': row, 'metadata': item, 'conceptIds': item.conceptIds});
	}
	else {
		invalidCount++;
		cli.error("Invalid question data [Row: " + index + ", Code: " + item['code'] + "].");
	}
}

/**
 * Validates the questions - mandatory fields are presnet. Returns true if item is valid
 */
function validateQuestion(item) {

	if (item['type'] == 'mcq') {
		if (item.options.length < 2) return false;
	}
	else if (item['type'] == 'mtf') {
		if (item.lhs_options.length < 2) return false;
		if (item.rhs_options.length < 2) return false;
	}

	if (!item.code) return false;
	if (!item.title) return false;
	if (!item.template) return false;
	if (!item.template_id) return false;

	return true;
}

/**
 * Prepares the options before loading - sets asset (for resvalue), de-dupes options & shuffles them
 */
function processOptions(options, shuffle) {
	_.each(options, function(option, index) {
		if (typeof option.value.text != 'undefined') option.value.asset = option.value.text;
		else if (typeof option.value.image == 'undefined') option.value.asset = option.value.image;
    });

    options = _.uniq(options, false, function(p){ return p.value.asset;});
    if (shuffle) options = _.shuffle(options);
    return options;
}

// ################################################################################################
// API call and response
// ################################################################################################


/**
 * Returns the function to load the item in the middleware. This is called using async.parallelLimit
 */
function getMWAPICallfunction(item) {
	var returnFn = function(callback) {
		var reqBody = {"request": {"assessment_item": {}}};
		reqBody.request.assessment_item.identifier = item.metadata.code;
		reqBody.request.assessment_item.objectType = "AssessmentItem";
		reqBody.request.assessment_item.metadata = item.metadata;
		var conceptIds = item.conceptIds;
		if (_.isArray(conceptIds) && conceptIds.length > 0) {
			reqBody.request.assessment_item.outRelations = [];
			conceptIds.forEach(function(cid) {
				reqBody.request.assessment_item.outRelations.push({"endNodeId": cid, "relationType": "associatedTo"});
			});
		}
		var args = {
			path: {id:item.metadata.code, tid:'domain'},
	        headers: {
	            "Content-Type": "application/json",
	            "user-id": 'csv-import'
	        },
	        data: reqBody,
	        requestConfig:{
            	timeout: 240000
        	},
	        responseConfig:{
            	timeout: 240000
        	}
	    };
	    var url = API_ENDPOINT + CREATE_ITEM_URL;
	    client.patch(url, args, function(data, response) {
	        parseResponse(item, data, callback);
	    }).on('error', function(err) {
	    	errorMap[item.rownum] = "Connection error: " + err;
	        callback(null, 'ok');
	    });
	};
	return returnFn;
}

/**
 * Reads the API response and builds the response/error maps
 */
function parseResponse(item, data, callback) {
	cli.progress(++calls / items.length);

	var responseData;
    if(typeof data == 'string') {
        try {
            responseData = JSON.parse(data);
        } catch(err) {
            errorMap[item.metadata.code] = 'Invalid API response for: ' + item.identifier;
        }
    } else {
    	responseData = data;
    }
    if (responseData) {
    	if (responseData.params) {
    		if (responseData.params.status == 'failed') {
    			var error = {'error': responseData.params.errmsg};
	    		if (responseData.result && responseData.result.messages) {
	    			error.messages = responseData.result.messages;
	    		}
	    		errorMap[item.metadata.rownum] = error;
	    	} else {
	    		resultMap[item.metadata.code] = responseData.result.node_id;
	    	}
    	} else {
    		errorMap[item.index + 1] = 'Invalid API response for: ' + item.identifier;
    	}
    } else {
    	errorMap[item.index + 1] = 'Invalid API response for: ' + item.identifier;
    }
    callback(null, 'ok');
}

// ################################################################################################
// CSV parser functions
// ################################################################################################

/**
 * Parses the CSV to return the item data for the given row, using the mapping definitions
 */
function getItemRecord(row, startCol, mapping, item) {
	for (var x in mapping) {
		var data = mapping[x];
		if (_.isArray(data)) {
			item[x] = [];
			getArrayData(row, startCol, data, item[x]);
		} else {
			if (data['col-def']) {
				var val = getColumnValue(row, startCol, data['col-def']);
				if (null != val)
					item[x] = val;
			} else if (data['literal'] !== undefined) {
				var val = data['literal'];
				if (null != val)
					item[x] = val;
			} else if (_.isObject(data)) {
				item[x] = {};
				getObjectData(row, startCol, data, item[x]);
			}
		}
	}
}

/**
 * Inner parser for nested JSON objects (e.g option)
 */
function getObjectData(row, startCol, obj, objData) {
	for (var k in obj) {
		var data = obj[k];
		if (data['col-def']) {
			var val = getColumnValue(row, startCol, data['col-def']);
			if (null != val)
				objData[k] = val;
		} else if (data['literal'] !== undefined) {
			var val = data['literal'];
			if (null != val)
				objData[k] = val;
		} else if (_.isObject(data)) {
			objData[k] = {};
			getObjectData(row, startCol, data, objData[k]);
		}
	}
}

/**
 * Inner parser for nested arrays (e.g. options array)
 */
function getArrayData(row, startCol, arr, arrData) {
	arr.forEach(function(data) {
		if (data['col-def']) {
			var val = getColumnValue(row, startCol, data['col-def']);
			if (null != val)
				arrData.push(val);
		} else if (_.isObject(data)) {
			var objData = {};
			getObjectData(row, startCol, data, objData);
			var add = false;
			for (var k in objData) {
				if (!isEmptyObject(objData[k])) {
					add = true;
				}
			}
			if (add) {
				arrData.push(objData);
			}
		}
	});
}

/**
 * Returns the value in current row * column (current cell) using the mapping.
 */
function getColumnValue(row, startCol, colDef) {
	var col = colDef.column;
	var result;
	if (_.isArray(col)) {
		var data = [];
		col.forEach(function(c) {
			var val = _getValueFromRow(row, startCol, c, colDef);
			if (null != val) {
				data.push(val);
			}
		});
		return data.length > 0 ? data : null;
	} else {
		return _getValueFromRow(row, startCol, col, colDef);
	}
}

/**
 * Internal parser method to look at the col-def and read the cell value
 */
function _getValueFromRow(row, startCol, col, def) {
	var index = col + startCol;
	var data = row[index];

	if (data && data != null) {
		if (def.type == 'boolean') {
			var val = data.trim().toLowerCase();
			if (val == 'yes' || val == 'true') {
				return true;
			} else {
				return false;
			}
		}
		else if (def.type == 'list') {
			data = data.split(',');
			data = data.map(function(e) { return e.trim();});
			return data;
		}
		else if (def.type == 'number') {
			if (_.isFinite(data)) {
				data = parseFloat(data);
				return data;
			}
		}
	}

	return (data && data != null) ? data.trim() : null;
}

/**
 * Utility method that validates if the object is empty
 */
function isEmptyObject(obj) {
	if (_.isEmpty(obj)) {
		return true;
	} else {
		for (var k in obj) {
			if (_.isObject(obj[k])) {
				return isEmptyObject(obj[k]);
			} else {
				if (isEmpty(obj[k])) {
					return true;
				}
			}
		}
	}
	return false;
}

/**
 * Utility method that returns true if we are in a toy shop
 */
function isEmpty(val) {
	if (val == null) {
		return true;
	} else {
		if (_.isString(val) && val.trim().length <= 0)
			return true;
	}
	return false;
}

/**
 * Returns the number of keys in the object
 */
function getNumberOfKeys(obj)
{
    var count = 0;
    for(var prop in obj)
    {
        count++;
    }
    return count;
}
