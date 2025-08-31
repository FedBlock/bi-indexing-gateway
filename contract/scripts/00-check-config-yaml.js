#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

async function checkConfigYaml() {
  console.log('🔍 config.yaml 직접 확인 시작\n');

  try {
    // config.yaml 파일 경로
    const configPath = path.join(process.cwd(), '../idxmngr-go/config.yaml');
    
    // 파일 존재 확인
    if (!fs.existsSync(configPath)) {
      console.error(`❌ config.yaml 파일을 찾을 수 없음: ${configPath}`);
      return;
    }

    // 파일 읽기
    const configContent = fs.readFileSync(configPath, 'utf8');
    console.log('📁 config.yaml 내용:');
    console.log(configContent);
    console.log('');

    // YAML 파싱
    const config = yaml.load(configContent);
    
    if (config && config.items && Array.isArray(config.items)) {
      console.log(`✅ 인덱스 개수: ${config.items.length}개\n`);
      
      config.items.forEach((item, index) => {
        console.log(`📋 인덱스 ${index + 1}:`);
        console.log(`   🆔 IndexID: ${item.idxid || 'N/A'}`);
        console.log(`   📝 IndexName: ${item.idxname || 'N/A'}`);
        console.log(`   🔑 KeyCol: ${item.keycol || 'N/A'}`);
        console.log(`   📁 FilePath: ${item.filepath || 'N/A'}`);
        console.log(`   📏 KeySize: ${item.keysize || 'N/A'}`);
        console.log(`   📊 BlockNum: ${item.blocknum || 'N/A'}`);
        console.log(`   📈 CallCnt: ${item.callcnt || 'N/A'}`);
        console.log(`   🔑 KeyCnt: ${item.keycnt || 'N/A'}`);
        console.log(`   📊 IndexDataCnt: ${item.indexdatacnt || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ config.yaml에 items 배열이 없음');
    }

    console.log('🎉 config.yaml 확인 완료!');

  } catch (error) {
    console.error(`❌ config.yaml 확인 중 오류 발생: ${error.message}`);
  }
}

// 메인 실행
if (require.main === module) {
  checkConfigYaml().catch(console.error);
}

module.exports = { checkConfigYaml };
