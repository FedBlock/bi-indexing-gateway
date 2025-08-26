const IdxmngrClient = require('./idxmngr-client');

async function createHyundaiIndex() {
  console.log('🔨 현대자동차 인덱스 생성 중...\n');
  
  const client = new IdxmngrClient();
  
  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const result = await client.createIndex(
      'org_hyundai',
      'Organization_Hyundai',
      'IndexableData_OrganizationName',
      'hyundai.bf',
      32
    );
    
    console.log('✅ 인덱스 생성 결과:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ 에러:', error.message);
  } finally {
    client.close();
  }
}

createHyundaiIndex().catch(console.error);
