// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract AccessManagement {
    enum RequestStatus { PENDING, APPROVED, REJECTED }

    uint256 private requestId;

    // RequestDetail 구조체 - 패킹 최적화
    struct RequestDetail {
        address requester;      // 20 bytes
        address resourceOwner; // 20 bytes
        RequestStatus status; // 1 byte (enum은 uint8로 저장)
        string purpose;       // 동적 크기
        string organizationName;  // 추가
    }
    
    // 매핑
    mapping(uint256 => RequestDetail) private requestDetail;
    mapping(address => uint256[]) private requestIdArr;

    // 이벤트 - organizationName 추가
    event AccessRequestsSaved(
        uint256  requestId, 
        address  requester, 
        address indexed resourceOwner, 
        string indexed purpose,
        string indexed organizationName  // 추가
    );
    event RequestStatusChanged(uint256 indexed requestId, RequestStatus status);

    // 커스텀 에러 (가스비 절약)
    error InvalidResourceOwner();
    error InvalidPurpose();
    error InvalidOrganizationName();  
    error InvalidRequestId();
    error RequestNotFound();
    error OnlyOwnerCanChangeStatus();
    error RequestAlreadyProcessed();
    error InvalidStatusChange();

    /**
     * @notice 리소스 접근 요청을 생성합니다
     * @dev PENDING 상태로 새로운 접근 요청을 생성하고 고유한 requestId를 반환합니다
     * @param _resourceOwner 리소스를 소유한 주소 (요청 승인/거부 권한자)
     * @param _purpose 접근 요청의 목적 또는 사유
     * @param _organizationName 요청자가 소속된 기관명
     * @return requestId 생성된 요청의 고유 식별자
     * @custom:security 입력값 유효성 검증 후 저장
     * @custom:gas-optimization unchecked 블록으로 requestId 증가 최적화
     */
    function saveRequest(address _resourceOwner, string calldata _purpose, string calldata _organizationName) 
        external 
        returns (uint256) 
    {
        // 1. 입력값 검증 - 커스텀 에러 사용
        if (_resourceOwner == address(0)) revert InvalidResourceOwner();
        if (bytes(_purpose).length == 0) revert InvalidPurpose();
        if (bytes(_organizationName).length == 0) revert InvalidOrganizationName();

        // 2. requestId 증가 (unchecked로 가스비 절약)
        unchecked {
            ++requestId;
        }

        // 3. 새 RequestDetail 생성하여 저장
        RequestDetail storage newRequest = requestDetail[requestId];
        newRequest.requester = msg.sender;
        newRequest.resourceOwner = _resourceOwner;
        newRequest.purpose = _purpose;
        newRequest.organizationName = _organizationName;  // 추가
        newRequest.status = RequestStatus.PENDING;

        // 4. owner의 requestId 목록에 추가
        requestIdArr[_resourceOwner].push(requestId);

        // 5. 이벤트 발생
        emit AccessRequestsSaved(requestId, msg.sender, _resourceOwner, _purpose, _organizationName);

        // 6. requestId 반환
        return requestId;
    }

    /**
     * @notice 접근 요청의 상태를 변경합니다 (승인/거부)
     * @dev 리소스 소유자만 PENDING 상태의 요청을 APPROVED 또는 REJECTED로 변경 가능
     * @param _requestId 상태를 변경할 요청의 고유 식별자
     * @param _requestStatus 새로운 요청 상태 (APPROVED 또는 REJECTED만 가능)
     * @custom:access-control 리소스 소유자만 호출 가능
     * @custom:state-check PENDING 상태의 요청만 변경 가능
     */
    function saveRequestStatus(uint256 _requestId, RequestStatus _requestStatus) 
        external 
    {
        // 1. 요청 존재 확인
        if (_requestId == 0 || _requestId > requestId) revert InvalidRequestId();
        
        RequestDetail storage request = requestDetail[_requestId];
        if (request.requester == address(0)) revert RequestNotFound();

        // 2. 소유자 권한 확인
        if (msg.sender != request.resourceOwner) revert OnlyOwnerCanChangeStatus();

        // 3. 현재 상태가 PENDING인지 확인
        if (request.status != RequestStatus.PENDING) revert RequestAlreadyProcessed();

        // 4. 유효한 상태 변경인지 확인
        if (_requestStatus != RequestStatus.APPROVED && _requestStatus != RequestStatus.REJECTED) {
            revert InvalidStatusChange();
        }

        // 5. 상태 변경
        request.status = _requestStatus;

        // 6. 이벤트 발생
        emit RequestStatusChanged(_requestId, _requestStatus);
    }

    /**
     * @notice 특정 리소스 소유자에게 요청된 모든 requestId 목록을 조회합니다
     * @dev 리소스 소유자 주소를 키로 하여 해당 주소로 요청된 모든 requestId 배열을 반환
     * @param owner 리소스 소유자의 지갑 주소
     * @return requestIds 해당 소유자에게 요청된 모든 requestId 배열
     * @custom:view-function 상태를 변경하지 않는 조회 전용 함수
     */
    function getRequestId(address owner) external view returns (uint256[] memory) {
        return requestIdArr[owner];
    }

    /**
     * @notice 특정 requestId에 해당하는 요청의 상세 정보를 조회합니다
     * @dev requestId가 유효하고 존재하는 요청인지 검증 후 RequestDetail 구조체를 반환
     * @param _requestId 조회하고자 하는 요청의 고유 식별자
     * @return RequestDetail 요청자, 리소스소유자, 상태, 목적, 기관명을 포함한 요청 상세 정보
     * @custom:validation 유효하지 않거나 존재하지 않는 requestId에 대해 커스텀 에러 발생
     * @custom:view-function 상태를 변경하지 않는 조회 전용 함수
     */
    function getRequestById(uint256 _requestId) external view returns (RequestDetail memory) {
        if (_requestId == 0 || _requestId > requestId) revert InvalidRequestId();
        RequestDetail memory detail = requestDetail[_requestId];
        if (detail.requester == address(0)) revert RequestNotFound();
        return detail;
    }
}   