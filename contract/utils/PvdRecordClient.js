const { ethers } = require("hardhat");

class PvdRecordClient {
    constructor(contractAddress, signer) {
        this.contractAddress = contractAddress;
        this.signer = signer;
    }

    async getContract() {
        const PvdRecord = await ethers.getContractFactory("PvdRecord");
        return PvdRecord.attach(this.contractAddress).connect(this.signer);
    }

    /**
     * 새로운 PVD 레코드 생성 또는 업데이트
     * @param {Object} pvdData PVD 데이터 객체
     * @returns {Promise<string>} 트랜잭션 ID
     */
    async createUpdatePvd(pvdData) {
        const contract = await this.getContract();
        
        const pvdStruct = {
            obuId: pvdData.obuId || "",
            collectionDt: pvdData.collectionDt || "",
            startvectorLatitude: pvdData.startvectorLatitude || "",
            startvectorLongitude: pvdData.startvectorLongitude || "",
            transmisstion: pvdData.transmisstion || "",
            speed: pvdData.speed || 0,
            hazardLights: pvdData.hazardLights || "",
            leftTurnSignalOn: pvdData.leftTurnSignalOn || "",
            rightTurnSignalOn: pvdData.rightTurnSignalOn || "",
            steering: pvdData.steering || 0,
            rpm: pvdData.rpm || 0,
            footbrake: pvdData.footbrake || "",
            gear: pvdData.gear || "",
            accelator: pvdData.accelator || 0,
            wipers: pvdData.wipers || "",
            tireWarnLeftF: pvdData.tireWarnLeftF || "",
            tireWarnLeftR: pvdData.tireWarnLeftR || "",
            tireWarnRightF: pvdData.tireWarnRightF || "",
            tireWarnRightR: pvdData.tireWarnRightR || "",
            tirePsiLeftF: pvdData.tirePsiLeftF || 0,
            tirePsiLeftR: pvdData.tirePsiLeftR || 0,
            tirePsiRightF: pvdData.tirePsiRightF || 0,
            tirePsiRightR: pvdData.tirePsiRightR || 0,
            fuelPercent: pvdData.fuelPercent || 0,
            fuelLiter: pvdData.fuelLiter || 0,
            totaldist: pvdData.totaldist || 0,
            rsuId: pvdData.rsuId || "",
            msgId: pvdData.msgId || "",
            startvectorHeading: pvdData.startvectorHeading || 0,
            timestamp: 0,
            blockNumber: 0
        };

        const tx = await contract.createUpdatePvd(pvdData.obuId, pvdStruct);
        await tx.wait();
        return tx.hash;
    }

    /**
     * PVD 레코드 조회
     * @param {string} obuId OBU ID
     * @returns {Promise<Object>} PVD 데이터
     */
    async readPvd(obuId) {
        const contract = await this.getContract();
        return await contract.readPvd(obuId);
    }

    /**
     * PVD 레코드 업데이트
     * @param {string} obuId OBU ID
     * @param {Object} pvdData 업데이트할 PVD 데이터
     * @returns {Promise<string>} 트랜잭션 해시
     */
    async updatePvd(obuId, pvdData) {
        const contract = await this.getContract();
        
        const pvdStruct = {
            obuId: obuId,
            collectionDt: pvdData.collectionDt || "",
            startvectorLatitude: pvdData.startvectorLatitude || "",
            startvectorLongitude: pvdData.startvectorLongitude || "",
            transmisstion: pvdData.transmisstion || "",
            speed: pvdData.speed || 0,
            hazardLights: pvdData.hazardLights || "",
            leftTurnSignalOn: pvdData.leftTurnSignalOn || "",
            rightTurnSignalOn: pvdData.rightTurnSignalOn || "",
            steering: pvdData.steering || 0,
            rpm: pvdData.rpm || 0,
            footbrake: pvdData.footbrake || "",
            gear: pvdData.gear || "",
            accelator: pvdData.accelator || 0,
            wipers: pvdData.wipers || "",
            tireWarnLeftF: pvdData.tireWarnLeftF || "",
            tireWarnLeftR: pvdData.tireWarnLeftR || "",
            tireWarnRightF: pvdData.tireWarnRightF || "",
            tireWarnRightR: pvdData.tireWarnRightR || "",
            tirePsiLeftF: pvdData.tirePsiLeftF || 0,
            tirePsiLeftR: pvdData.tirePsiLeftR || 0,
            tirePsiRightF: pvdData.tirePsiRightF || 0,
            tirePsiRightR: pvdData.tirePsiRightR || 0,
            fuelPercent: pvdData.fuelPercent || 0,
            fuelLiter: pvdData.fuelLiter || 0,
            totaldist: pvdData.totaldist || 0,
            rsuId: pvdData.rsuId || "",
            msgId: pvdData.msgId || "",
            startvectorHeading: pvdData.startvectorHeading || 0,
            timestamp: 0,
            blockNumber: 0
        };

        const tx = await contract.updatePvd(obuId, pvdStruct);
        await tx.wait();
        return tx.hash;
    }

    /**
     * PVD 레코드 삭제
     * @param {string} obuId OBU ID
     * @returns {Promise<string>} 트랜잭션 해시
     */
    async deletePvd(obuId) {
        const contract = await this.getContract();
        const tx = await contract.deletePvd(obuId);
        await tx.wait();
        return tx.hash;
    }

    /**
     * PVD 존재 여부 확인
     * @param {string} obuId OBU ID
     * @returns {Promise<boolean>} 존재 여부
     */
    async pvdExists(obuId) {
        const contract = await this.getContract();
        return await contract.pvdExists(obuId);
    }

    /**
     * 모든 PVD 레코드 조회
     * @returns {Promise<Array>} PVD 데이터 배열
     */
    async getAllPvds() {
        const contract = await this.getContract();
        return await contract.getPvdWorldStates();
    }

    /**
     * 모든 키 목록 조회
     * @returns {Promise<Array>} 키 배열
     */
    async getAllKeys() {
        const contract = await this.getContract();
        return await contract.getKeyLists();
    }

    /**
     * 특정 키의 히스토리 조회
     * @param {string} obuId OBU ID
     * @returns {Promise<Array>} 히스토리 배열
     */
    async getHistory(obuId) {
        const contract = await this.getContract();
        return await contract.getHistoryForKey(obuId);
    }

    /**
     * 페이지네이션을 통한 레코드 조회
     * @param {number} offset 시작 인덱스
     * @param {number} limit 조회할 개수
     * @returns {Promise<Array>} PVD 데이터 배열
     */
    async getPvdsWithPagination(offset, limit) {
        const contract = await this.getContract();
        return await contract.getPvdsWithPagination(offset, limit);
    }

    /**
     * 전체 레코드 개수 조회
     * @returns {Promise<number>} 전체 레코드 개수
     */
    async getTotalRecordCount() {
        const contract = await this.getContract();
        return await contract.getTotalRecordCount();
    }

    /**
     * 권한 부여
     * @param {string} userAddress 사용자 주소
     * @returns {Promise<string>} 트랜잭션 해시
     */
    async authorizeUser(userAddress) {
        const contract = await this.getContract();
        const tx = await contract.authorizeUser(userAddress);
        await tx.wait();
        return tx.hash;
    }

    /**
     * 권한 해제
     * @param {string} userAddress 사용자 주소
     * @returns {Promise<string>} 트랜잭션 해시
     */
    async revokeUser(userAddress) {
        const contract = await this.getContract();
        const tx = await contract.revokeUser(userAddress);
        await tx.wait();
        return tx.hash;
    }
}

module.exports = PvdRecordClient;
