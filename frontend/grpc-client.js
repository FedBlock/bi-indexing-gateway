// idxmngr gRPC 클라이언트
class IdxmngrClient {
    constructor() {
        this.serverAddr = 'localhost:50052';
        this.isConnected = false;
    }

    // 연결 확인
    async checkConnection() {
        try {
            const response = await fetch(`http://${this.serverAddr}/health`);
            this.isConnected = response.ok;
            return this.isConnected;
        } catch (error) {
            this.isConnected = false;
            return false;
        }
    }

    // 인덱스 생성
    async createIndex(indexData) {
        try {
            const response = await fetch(`http://${this.serverAddr}/createIndex`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(indexData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('인덱스 생성 실패:', error);
            throw error;
        }
    }

    // 데이터 삽입
    async insertData(insertData) {
        try {
            const response = await fetch(`http://${this.serverAddr}/insertData`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(insertData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('데이터 삽입 실패:', error);
            throw error;
        }
    }

    // 데이터 검색
    async searchData(searchData) {
        try {
            const response = await fetch(`http://${this.serverAddr}/searchData`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(searchData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('데이터 검색 실패:', error);
            throw error;
        }
    }

    // 인덱스 목록 조회
    async getIndexList() {
        try {
            const response = await fetch(`http://${this.serverAddr}/indexList`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('인덱스 목록 조회 실패:', error);
            throw error;
        }
    }
}

// 전역 인스턴스
window.idxmngrClient = new IdxmngrClient();
