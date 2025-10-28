/**
 * 과속 구간 분석 스크립트
 * CSV 데이터에서 과속 차량을 식별하고 위치별 과속 빈도를 계산
 */

const fs = require('fs');
const path = require('path');

// 설정
const CONFIG = {
    SPEED_LIMIT_URBAN: 60,      // 도심 제한속도 (km/h)
    SPEED_LIMIT_SUBURBAN: 80,   // 교외 제한속도 (km/h)
    SPEED_LIMIT_HIGHWAY: 110,   // 고속도로 제한속도 (km/h)
    INVALID_SPEED: 589,         // 무효 속도값
    GRID_SIZE: 0.001,           // 히트맵 그리드 크기 (약 100m)
};

/**
 * CSV 파일 읽기 및 파싱
 */
function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const record = {};
        
        headers.forEach((header, index) => {
            record[header] = values[index];
        });
        
        data.push(record);
    }
    
    return data;
}

/**
 * 속도 기반 도로 타입 추정
 */
function estimateRoadType(speed) {
    if (speed <= 60) return 'urban';
    if (speed <= 80) return 'suburban';
    return 'highway';
}

/**
 * 과속 여부 판정
 */
function isSpecding(speed, roadType = 'suburban') {
    const limits = {
        urban: CONFIG.SPEED_LIMIT_URBAN,
        suburban: CONFIG.SPEED_LIMIT_SUBURBAN,
        highway: CONFIG.SPEED_LIMIT_HIGHWAY,
    };
    
    return speed > limits[roadType];
}

/**
 * 위치를 그리드로 변환 (히트맵용)
 */
function getGridKey(lat, lng) {
    const gridLat = Math.floor(parseFloat(lat) / CONFIG.GRID_SIZE) * CONFIG.GRID_SIZE;
    const gridLng = Math.floor(parseFloat(lng) / CONFIG.GRID_SIZE) * CONFIG.GRID_SIZE;
    return `${gridLat.toFixed(5)},${gridLng.toFixed(5)}`;
}

/**
 * 과속 데이터 분석
 */
function analyzeSpeedingData(csvPath) {
    console.log('📊 CSV 데이터 분석 시작...');
    
    const data = parseCSV(csvPath);
    console.log(`총 ${data.length}개 레코드 로드됨`);
    
    // 통계 변수
    const stats = {
        total: 0,
        valid: 0,
        speeding: 0,
        speedingByVehicle: {},
        speedingByLocation: {},
        heatmapData: [],
        topSpeedingLocations: [],
    };
    
    // 위치별 과속 빈도 맵
    const locationMap = new Map();
    
    // 데이터 분석
    data.forEach(record => {
        stats.total++;
        
        const speed = parseInt(record.SPEED);
        const lat = parseFloat(record.STARTVECTOR_LATITUDE);
        const lng = parseFloat(record.STARTVECTOR_LONGITUDE);
        const obuId = record.OBU_ID;
        
        // 무효 데이터 필터링
        if (speed === CONFIG.INVALID_SPEED || isNaN(speed) || isNaN(lat) || isNaN(lng)) {
            return;
        }
        
        stats.valid++;
        
        // 과속 판정 (교외 기준 80km/h)
        if (isSpecding(speed, 'suburban')) {
            stats.speeding++;
            
            // 차량별 과속 횟수
            if (!stats.speedingByVehicle[obuId]) {
                stats.speedingByVehicle[obuId] = {
                    count: 0,
                    maxSpeed: 0,
                    locations: []
                };
            }
            stats.speedingByVehicle[obuId].count++;
            stats.speedingByVehicle[obuId].maxSpeed = Math.max(
                stats.speedingByVehicle[obuId].maxSpeed,
                speed
            );
            
            // 위치별 과속 빈도 (그리드 기반)
            const gridKey = getGridKey(lat, lng);
            if (!locationMap.has(gridKey)) {
                const [gridLat, gridLng] = gridKey.split(',').map(parseFloat);
                locationMap.set(gridKey, {
                    lat: gridLat,
                    lng: gridLng,
                    count: 0,
                    totalSpeed: 0,
                    maxSpeed: 0,
                    vehicles: new Set()
                });
            }
            
            const location = locationMap.get(gridKey);
            location.count++;
            location.totalSpeed += speed;
            location.maxSpeed = Math.max(location.maxSpeed, speed);
            location.vehicles.add(obuId);
            
            // 개별 과속 이벤트 저장 (상위 100개만)
            if (stats.speedingByLocation.length < 100) {
                stats.speedingByLocation.push({
                    obuId,
                    lat,
                    lng,
                    speed,
                    timestamp: record.COLLECTION_DT,
                    exceeds: speed - CONFIG.SPEED_LIMIT_SUBURBAN
                });
            }
        }
    });
    
    // 히트맵 데이터 생성
    locationMap.forEach((location, key) => {
        stats.heatmapData.push({
            lat: location.lat,
            lng: location.lng,
            count: location.count,
            avgSpeed: Math.round(location.totalSpeed / location.count),
            maxSpeed: location.maxSpeed,
            intensity: location.count, // 과속 빈도가 intensity
            vehicleCount: location.vehicles.size
        });
    });
    
    // 과속 빈도 높은 위치 정렬 (Top 20)
    stats.topSpeedingLocations = stats.heatmapData
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .map((loc, index) => ({
            rank: index + 1,
            ...loc
        }));
    
    // 차량별 과속 순위 (Top 10)
    const topSpeedingVehicles = Object.entries(stats.speedingByVehicle)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 10)
        .map(([obuId, data], index) => ({
            rank: index + 1,
            obuId,
            ...data
        }));
    
    return {
        stats,
        topSpeedingVehicles,
        heatmapData: stats.heatmapData,
        topLocations: stats.topSpeedingLocations
    };
}

/**
 * 결과를 JSON 파일로 저장
 */
function saveResults(results, outputDir) {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // 전체 결과
    fs.writeFileSync(
        path.join(outputDir, 'speeding-analysis.json'),
        JSON.stringify(results, null, 2)
    );
    
    // 히트맵 데이터 (별도 파일)
    fs.writeFileSync(
        path.join(outputDir, 'heatmap-data.json'),
        JSON.stringify(results.heatmapData, null, 2)
    );
    
    // 통계 리포트 생성
    const report = generateReport(results);
    fs.writeFileSync(
        path.join(outputDir, 'speeding-report.txt'),
        report
    );
    
    console.log(`✅ 결과 저장 완료: ${outputDir}`);
}

/**
 * 텍스트 리포트 생성
 */
function generateReport(results) {
    const { stats, topSpeedingVehicles, topLocations } = results;
    
    let report = '';
    report += '====================================\n';
    report += '   제주도 PVD 과속 구간 분석 리포트\n';
    report += '====================================\n\n';
    
    report += '📊 전체 통계\n';
    report += `- 총 레코드 수: ${stats.total.toLocaleString()}\n`;
    report += `- 유효 레코드: ${stats.valid.toLocaleString()}\n`;
    report += `- 과속 레코드: ${stats.speeding.toLocaleString()}\n`;
    report += `- 과속 비율: ${((stats.speeding / stats.valid) * 100).toFixed(2)}%\n`;
    report += `- 과속 지점 수: ${stats.heatmapData.length}\n\n`;
    
    report += '🚗 과속 차량 TOP 10\n';
    report += '-'.repeat(60) + '\n';
    topSpeedingVehicles.forEach(vehicle => {
        report += `${vehicle.rank}. ${vehicle.obuId}\n`;
        report += `   과속 횟수: ${vehicle.count}회, 최고 속도: ${vehicle.maxSpeed}km/h\n`;
    });
    
    report += '\n📍 과속 다발 지역 TOP 20\n';
    report += '-'.repeat(60) + '\n';
    topLocations.forEach(loc => {
        report += `${loc.rank}. 위치: (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})\n`;
        report += `   과속 횟수: ${loc.count}회, 평균 속도: ${loc.avgSpeed}km/h, 최고 속도: ${loc.maxSpeed}km/h\n`;
        report += `   관련 차량 수: ${loc.vehicleCount}대\n`;
    });
    
    report += '\n====================================\n';
    report += '⚠️  과속 기준: 80km/h 초과 (교외 도로)\n';
    report += '====================================\n';
    
    return report;
}

/**
 * 메인 실행
 */
function main() {
    const csvPath = path.join(__dirname, 'pvd_hist_20k.csv');
    const outputDir = path.join(__dirname, 'analysis-results');
    
    console.log('🚀 과속 구간 분석 시작\n');
    console.log(`입력 파일: ${csvPath}`);
    console.log(`출력 디렉토리: ${outputDir}\n`);
    
    try {
        const results = analyzeSpeedingData(csvPath);
        saveResults(results, outputDir);
        
        console.log('\n' + generateReport(results));
        
        console.log('\n✅ 분석 완료!');
        console.log(`📁 결과 파일:`);
        console.log(`   - ${outputDir}/speeding-analysis.json (전체 분석 결과)`);
        console.log(`   - ${outputDir}/heatmap-data.json (히트맵 데이터)`);
        console.log(`   - ${outputDir}/speeding-report.txt (텍스트 리포트)`);
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        process.exit(1);
    }
}

// 스크립트 직접 실행 시
if (require.main === module) {
    main();
}

module.exports = {
    analyzeSpeedingData,
    parseCSV,
    isSpecding,
    getGridKey
};

