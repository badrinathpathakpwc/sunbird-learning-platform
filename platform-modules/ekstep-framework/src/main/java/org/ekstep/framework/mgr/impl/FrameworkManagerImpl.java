package org.ekstep.framework.mgr.impl;

import java.util.Map;

import org.ekstep.common.dto.Response;
import org.ekstep.common.exception.ClientException;
import org.ekstep.common.exception.ResourceNotFoundException;
import org.ekstep.common.exception.ResponseCode;
import org.ekstep.framework.enums.FrameworkEnum;
import org.ekstep.framework.mgr.IFrameworkManager;
import org.ekstep.graph.dac.enums.GraphDACParams;
import org.ekstep.graph.dac.model.Node;
import org.springframework.stereotype.Component;

/**
 * The Class <code>FrameworkManagerImpl</code> is the implementation of
 * <code>IFrameworkManager</code> for all the operation including CRUD operation
 * and High Level Operations.
 * 
 * 
 * @author gauraw
 *
 */
@Component
public class FrameworkManagerImpl extends BaseFrameworkManager implements IFrameworkManager {

	private static final String FRAMEWORK_OBJECT_TYPE = "Framework";


	/*
	 * create framework
	 * 
	 * @param Map request
	 * 
	 */
	@Override
	public Response createFramework(Map<String, Object> request, String channelId) throws Exception {
		if (null == request)
			return ERROR("ERR_INVALID_FRMAEWORK_OBJECT", "Invalid Request", ResponseCode.CLIENT_ERROR);

		if (null == request.get("code"))
			throw new ClientException("ERR_FRAMEWORK_CODE_REQUIRED", "Unique code is mandatory for framework",
					ResponseCode.CLIENT_ERROR);

		request.put("identifier", (String) request.get("code"));

		if (validateChannel(channelId)) {
			return create(request, FRAMEWORK_OBJECT_TYPE);
		} else {
			return ERROR("ERR_INVALID_CHANNEL_ID", "Invalid Channel Id. Channel doesn't exist.",
					ResponseCode.CLIENT_ERROR);
		}

	}

	/*
	 * Read framework by Id
	 * 
	 * @param graphId
	 * 
	 * @param frameworkId
	 * 
	 */
	@Override
	public Response readFramework(String frameworkId) throws Exception {
		return read(frameworkId, FRAMEWORK_OBJECT_TYPE, FrameworkEnum.framework.name());
	}

	/*
	 * Update Framework Details
	 * 
	 * @param frameworkId
	 * 
	 * @param Map<String,Object> map
	 * 
	 */
	@Override
	public Response updateFramework(String frameworkId, String channelId, Map<String, Object> map) throws Exception {
		Response getNodeResponse = getDataNode(GRAPH_ID, frameworkId);
		if (checkError(getNodeResponse))
			throw new ResourceNotFoundException("ERR_FRAMEWORK_NOT_FOUND",
					"Framework Not Found With Id : "+frameworkId);
		Node graphNode = (Node) getNodeResponse.get(GraphDACParams.node.name());
		String ownerChannelId = (String) graphNode.getMetadata().get("channel");
		if (!(channelId.equalsIgnoreCase(ownerChannelId))) {
			return ERROR("ERR_SERVER_ERROR_UPDATE_FRAMEWORK", "Invalid Request. Channel Id Not Matched.",
					ResponseCode.CLIENT_ERROR);
		}
		return update(frameworkId, FRAMEWORK_OBJECT_TYPE, map);

	}

	/*
	 * Read list of all framework based on criteria
	 * 
	 * @param Map<String,Object> map
	 * 
	 */
	@Override
	public Response listFramework(Map<String, Object> map) throws Exception {
		if (map == null)
			return ERROR("ERR_INVALID_SEARCH_REQUEST", "Invalid Search Request", ResponseCode.CLIENT_ERROR);

		return search(map, FRAMEWORK_OBJECT_TYPE, "frameworks", null);

	}

	/*
	 * Retire Framework - will update the status From "Live" to "Retire"
	 * 
	 * @param frameworkId
	 * 
	 */

	@Override
	public Response retireFramework(String frameworkId, String channelId) throws Exception {
		Response getNodeResponse = getDataNode(GRAPH_ID, frameworkId);
		if (checkError(getNodeResponse))
			throw new ResourceNotFoundException("ERR_FRAMEWORK_NOT_FOUND",
					"Framework Not Found With Id : "+frameworkId);
		Node frameworkNode = (Node) getNodeResponse.get(GraphDACParams.node.name());
		
		String ownerChannelId = (String) frameworkNode.getMetadata().get("channel");

		if (!(channelId.equalsIgnoreCase(ownerChannelId))) {
			return ERROR("ERR_SERVER_ERROR_UPDATE_FRAMEWORK", "Invalid Request. Channel Id Not Matched.",
					ResponseCode.CLIENT_ERROR);
		}
		
		return retire(frameworkId, FRAMEWORK_OBJECT_TYPE);

	}
	
}