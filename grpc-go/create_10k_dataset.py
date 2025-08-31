#!/usr/bin/env python3
"""
20,000개 CSV 데이터셋을 10,000개로 줄이는 스크립트
"""

import csv
import sys

def create_10k_dataset(input_file, output_file, target_count=10000):
    """
    CSV 파일에서 지정된 개수만큼 레코드를 추출하여 새 파일 생성
    
    Args:
        input_file (str): 입력 CSV 파일 경로
        output_file (str): 출력 CSV 파일 경로
        target_count (int): 추출할 레코드 수
    """
    try:
        with open(input_file, 'r', encoding='utf-8') as infile, \
             open(output_file, 'w', encoding='utf-8', newline='') as outfile:
            
            reader = csv.reader(infile)
            writer = csv.writer(outfile)
            
            # 헤더 읽기 및 쓰기
            header = next(reader)
            writer.writerow(header)
            print(f"✅ 헤더 복사: {header}")
            
            # 데이터 레코드 처리
            count = 0
            for row in reader:
                if count >= target_count:
                    break
                    
                writer.writerow(row)
                count += 1
                
                # 진행 상황 표시
                if count % 1000 == 0:
                    print(f"📊 처리된 레코드: {count:,}")
            
            print(f"🎉 완료! 총 {count:,}개 레코드를 {output_file}에 저장했습니다.")
            
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        sys.exit(1)

if __name__ == "__main__":
    input_file = "pvd_hist_20k.csv"
    output_file = "pvd_hist_10k.csv"
    
    print(f"🚀 {input_file}에서 10,000개 레코드 추출 시작...")
    create_10k_dataset(input_file, output_file, 10000)
    
    # 파일 크기 확인
    import os
    if os.path.exists(output_file):
        size = os.path.getsize(output_file)
        print(f"📁 생성된 파일 크기: {size:,} bytes ({size/1024:.1f} KB)")
