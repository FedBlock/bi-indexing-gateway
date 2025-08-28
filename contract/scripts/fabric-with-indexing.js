const { spawn } = require('child_process');
const path = require('path');

/**
 * Fabric 네트워크용 데이터 인덱싱 스크립트
 * grpc-go를 통해 Fabric 데이터를 idxmngr에 인덱싱 요청
 */

async function main() {
    console.log("🏢 Fabric 네트워크 - 데이터 인덱싱 시작...");

    // 명령행 인수 처리
    const obuId = process.argv[2] || "OBU_001";
    const speed = process.argv[3] || "80";

    console.log(`\n📋 입력된 데이터:`);
    console.log(`   OBU_ID: ${obuId}`);
    console.log(`   Speed: ${speed} km/h`);
    console.log(`   Network: fabric`);

    try {
        console.log(`\n🚀 grpc-go 클라이언트 실행 중...`);
        console.log(`   명령: go run client/client.go -cmd data -obu_id ${obuId} -speed ${speed}`);

        // grpc-go 클라이언트 실행
        const grpcProcess = spawn('go', ['run', 'client/client.go', '-cmd', 'data', '-obu_id', obuId, '-speed', speed], {
            cwd: path.join(__dirname, '../../grpc-go'),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // stdout 처리
        grpcProcess.stdout.on('data', (data) => {
            console.log(`📤 grpc-go 출력: ${data.toString().trim()}`);
        });

        // stderr 처리
        grpcProcess.stderr.on('data', (data) => {
            console.log(`⚠️  grpc-go 경고: ${data.toString().trim()}`);
        });

        // 프로세스 완료 대기
        await new Promise((resolve, reject) => {
            grpcProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ grpc-go 실행 성공! (종료 코드: ${code})`);
                    resolve();
                } else {
                    console.error(`❌ grpc-go 실행 실패! (종료 코드: ${code})`);
                    reject(new Error(`grpc-go 실행 실패: ${code}`));
                }
            });

            grpcProcess.on('error', (error) => {
                console.error(`❌ grpc-go 프로세스 오류: ${error.message}`);
                reject(error);
            });
        });

        console.log(`\n📋 전송된 데이터 정보:`);
        console.log(`   Network: fabric`);
        console.log(`   IndexID: fabric_speed`);
        console.log(`   FilePath: fabric_speed.bf`);
        console.log(`   OBU_ID: ${obuId}`);
        console.log(`   Speed: ${speed} km/h`);

    } catch (error) {
        console.error(`❌ Fabric 데이터 인덱싱 실패: ${error.message}`);
        throw error;
    }

    console.log(`\n🎉 Fabric 네트워크 - 데이터 인덱싱 완료!`);
    console.log(`   다음 단계: idxmngr에서 Fabric 데이터 검색 테스트`);
}

main()
    .then(() => {
        console.log(`\n✅ Fabric 데이터 인덱싱 성공!`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Fabric 데이터 인덱싱 실패:", error);
        process.exit(1);
    });
