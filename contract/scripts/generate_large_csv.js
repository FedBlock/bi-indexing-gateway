const fs = require('fs');

// 테스트용 지갑 주소들
const wallets = [
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
  '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
  '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
  '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
  '0xBcd4042DE499D14e55001CcbB24a551F3b954096',
  '0x71bE63f3384f5fb98995898A86B02Fb2426c5788'
];

// 목적 데이터 (3개만)
const purposes = ['수면', '혈압', '심박수'];

// 회사 데이터 (3개만)
const companies = ['BIMATRIX', 'Samsung', 'LG'];

// 성별 데이터
const genders = ['남자', '여자'];

console.log('📄 1000건 테스트 데이터 생성 중...');
console.log('📊 목적별 개수: 수면 150개, 혈압 423개, 심박수 427개');

let csvContent = 'resourceOwner,purpose,organizationName,gender\n';

// 목적별 개수 설정
const purposeCounts = {
  '수면': 150,
  '혈압': 423,
  '심박수': 427  // 나머지 (1000 - 150 - 423 = 427)
};

let rowIndex = 0;

// 각 목적별로 지정된 개수만큼 생성
purposes.forEach(purpose => {
  const count = purposeCounts[purpose];
  
  for (let i = 0; i < count; i++) {
    const wallet = wallets[rowIndex % wallets.length];
    const company = companies[rowIndex % companies.length];
    const gender = genders[rowIndex % genders.length];
    
    csvContent += `${wallet},${purpose},${company},${gender}\n`;
    rowIndex++;
  }
});

fs.writeFileSync('/home/blockchain/bi-index-migration/bi-index/contract/scripts/large_test_data.csv', csvContent);

console.log('✅ 1000건 데이터 생성 완료!');
console.log('📁 파일 위치: large_test_data.csv');

// 통계 출력
console.log('\n📊 생성된 데이터 통계:');
purposes.forEach(purpose => {
  const count = purposeCounts[purpose];
  console.log(`  ${purpose}: ${count}개`);
});

console.log(`\n📈 총 합계: ${Object.values(purposeCounts).reduce((sum, count) => sum + count, 0)}건`);
