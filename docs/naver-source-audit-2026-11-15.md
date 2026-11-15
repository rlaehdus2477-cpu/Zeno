# ZENO 병원정보 출처 감사 (2026-11-15)

검토 대상: `main`의 `owner.html` `HOSPITALS` (65개 병원) 기준 수정 전 출처 필드 감사. 조사 범위는 **URL 기록 현황**이며, 실제 네이버 내용의 사실 여부를 재검증한 결과가 아닙니다.

## 핵심 수치

- 등록된 병원: **65곳**
- 진료·병원 정보의 주요 출처 URL 필드 수: **121개**
- 네이버 이외 도메인 출처: **115개**
- 네이버 검색 URL로만 등록된 기록: **6개**
- 직접적인 네이버 상세 근거 URL: **0개**
- 비네이버 출처가 하나 이상 있는 병원: **55곳**

**주의:** 사용자 제보의 `97/102`와 이 감사의 `115/121`는 집계 범위가 다릅니다. 이 보고서는 6개 출처 필드(`sourceUrl`, `hoursSourceUrl`, `specialtyEvidenceUrl`, `specialtyPublicSourceUrl`, `publishedCareUrl`, `phoneSourceUrl`)에 등록된 URL만 계산합니다. `website`, `photos` 등 안내·이미지 URL은 출처로 오인하지 않도록 제외했습니다. 사용자가 올린 네이버 캡처 기록은 URL이 없어도 진료정보 일부의 출처일 수 있으므로 별도 검증 대상입니다.

## 출처 도메인 분포

| 도메인 | URL 기록 수 |
|---|---:|
| bemypet.kr | 32 |
| sungyesa.com | 14 |
| pet.kbizin.com | 14 |
| hospital.fitpetmall.com | 10 |
| www.locategrid.com | 8 |
| map.naver.com | 6 |
| www.cbuanimal.co.kr | 4 |
| naeumamc.co.kr | 3 |
| tour.virz.net | 3 |
| life.mustarddata.com | 3 |
| www.eumamc.com | 2 |
| prbaec.com | 2 |
| www.24daomamc.com | 2 |
| www.bowwow.co.kr | 2 |
| joicecat.co.kr | 2 |
| wooridoc.co.kr | 2 |
| iriwa.kr | 1 |
| dalamc.co.kr | 1 |
| eumamc.com | 1 |
| dkanimalhospital.imweb.me | 1 |
| www.google.com | 1 |
| bizno.net | 1 |
| ban-life.com | 1 |
| health.tali.kr | 1 |
| catshospital.tistory.com | 1 |
| healmedix.com | 1 |
| pet.wizztour.com | 1 |
| pet.kimgoon.kr | 1 |

## 네이버 이외 출처가 연결된 병원

아래 항목은 병원 자체가 잘못됐다는 뜻이 아니라, **정보별 근거가 네이버 출처 정책을 충족하지 못하는 기록**을 의미합니다.

| 병원명 | 비네이버 출처 기록(필드·도메인) |
|---|---|
| 24시청주나음동물메디컬 | sourceUrl (naeumamc.co.kr), specialtyEvidenceUrl (naeumamc.co.kr), specialtyPublicSourceUrl (naeumamc.co.kr) |
| 청주24시동물병원 | sourceUrl (bemypet.kr), publishedCareUrl (hospital.fitpetmall.com) |
| 동물병원 이야기 | sourceUrl (www.locategrid.com), hoursSourceUrl (iriwa.kr) |
| 달동물병원 | sourceUrl (dalamc.co.kr) |
| 24시 청주이음동물의료센터 | sourceUrl (eumamc.com), specialtyEvidenceUrl (www.eumamc.com), specialtyPublicSourceUrl (www.eumamc.com) |
| 두근동물병원 | hoursSourceUrl (dkanimalhospital.imweb.me) |
| 오송 봄봄 동물병원 | sourceUrl (bemypet.kr), specialtyPublicSourceUrl (sungyesa.com) |
| 푸른별안과동물병원 | sourceUrl (bemypet.kr), specialtyEvidenceUrl (prbaec.com), publishedCareUrl (prbaec.com) |
| 강서하이동물병원 | sourceUrl (bemypet.kr), publishedCareUrl (sungyesa.com) |
| 마마동물병원 | sourceUrl (bemypet.kr) |
| 별담동물병원 | sourceUrl (bemypet.kr) |
| 서원동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com) |
| 24시청주다옴동물의료센터 | sourceUrl (www.24daomamc.com), hoursSourceUrl (www.24daomamc.com) |
| 새론동물병원 | sourceUrl (www.locategrid.com), hoursSourceUrl (hospital.fitpetmall.com), publishedCareUrl (hospital.fitpetmall.com) |
| 강내동물병원 | sourceUrl (www.locategrid.com) |
| 청주지웰동물병원 | sourceUrl (www.locategrid.com), hoursSourceUrl (hospital.fitpetmall.com) |
| 블루동물종합병원 | sourceUrl (www.locategrid.com), hoursSourceUrl (pet.kbizin.com) |
| 소로동물병원 | sourceUrl (www.locategrid.com), hoursSourceUrl (sungyesa.com), publishedCareUrl (sungyesa.com) |
| 캣앤독동물병원 | sourceUrl (hospital.fitpetmall.com), hoursSourceUrl (hospital.fitpetmall.com), publishedCareUrl (hospital.fitpetmall.com) |
| 충북동물병원 | sourceUrl (www.locategrid.com), hoursSourceUrl (tour.virz.net) |
| 가경 나음 동물병원 | sourceUrl (www.locategrid.com), hoursSourceUrl (tour.virz.net) |
| 행복한동물병원 | sourceUrl (www.google.com), hoursSourceUrl (tour.virz.net), specialtyPublicSourceUrl (sungyesa.com) |
| 충북대학교 동물병원 | sourceUrl (www.cbuanimal.co.kr), hoursSourceUrl (www.cbuanimal.co.kr), specialtyEvidenceUrl (www.cbuanimal.co.kr), specialtyPublicSourceUrl (www.cbuanimal.co.kr) |
| 나래동물의료센터 | sourceUrl (bemypet.kr), hoursSourceUrl (sungyesa.com), specialtyPublicSourceUrl (hospital.fitpetmall.com), phoneSourceUrl (bizno.net) |
| 메이동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (ban-life.com), specialtyPublicSourceUrl (health.tali.kr) |
| 에이스동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com), specialtyPublicSourceUrl (catshospital.tistory.com) |
| 한샘동물병원 | sourceUrl (bemypet.kr), publishedCareUrl (sungyesa.com) |
| 산남동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com), specialtyPublicSourceUrl (sungyesa.com) |
| 세솔동물병원 | sourceUrl (bemypet.kr), phoneSourceUrl (life.mustarddata.com) |
| 아크 동물병원 | sourceUrl (bemypet.kr), phoneSourceUrl (healmedix.com) |
| 웜벳동물병원 | sourceUrl (bemypet.kr) |
| 정겨운 동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com) |
| 한빛동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com) |
| 고려동물메디컬센터 | sourceUrl (pet.kbizin.com) |
| 와와동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com), specialtyPublicSourceUrl (sungyesa.com) |
| 가까운동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com), specialtyPublicSourceUrl (sungyesa.com) |
| 늘품동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (sungyesa.com), specialtyPublicSourceUrl (sungyesa.com) |
| 24시청주i동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (hospital.fitpetmall.com) |
| 주주종합동물병원 | sourceUrl (bemypet.kr) |
| 스타동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com) |
| 다나동물병원 | sourceUrl (bemypet.kr) |
| 메인동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com), publishedCareUrl (sungyesa.com) |
| 새솔동물병원 | sourceUrl (bemypet.kr) |
| 서울동물병원 | sourceUrl (bemypet.kr), phoneSourceUrl (life.mustarddata.com) |
| 오창동물병원 | sourceUrl (bemypet.kr), phoneSourceUrl (life.mustarddata.com) |
| 웰니스동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com), specialtyPublicSourceUrl (www.bowwow.co.kr) |
| 인우동물병원 | sourceUrl (bemypet.kr) |
| 엘케이동물의료센터 | sourceUrl (bemypet.kr), hoursSourceUrl (pet.kbizin.com) |
| 내아이 동물병원 | sourceUrl (bemypet.kr), hoursSourceUrl (www.bowwow.co.kr), specialtyPublicSourceUrl (sungyesa.com) |
| 이즈동물병원 | hoursSourceUrl (pet.kbizin.com) |
| 센트럴동물병원 | sourceUrl (pet.wizztour.com) |
| 조이스고양이병원 | sourceUrl (joicecat.co.kr), hoursSourceUrl (joicecat.co.kr) |
| 강서동물병원 | sourceUrl (wooridoc.co.kr) |
| 그린동물병원 | sourceUrl (wooridoc.co.kr) |
| 정성환동물병원 | sourceUrl (pet.kimgoon.kr), hoursSourceUrl (hospital.fitpetmall.com) |

## 즉시 적용할 규칙

1. **검색 URL ≠ 증거 URL.** `map.naver.com/p/search/...`는 네이버 내 검색을 열 뿐 특정 진료 정보의 출처를 증명하지 않습니다.
2. 비네이버 링크를 네이버 검색 주소로 기계적으로 교체해 **확인 완료로 위장하지 않습니다**.
3. 기존 데이터는 삭제하지 않고 `네이버 재확인 필요`로 표시하되, 미검증 내용을 최신 확인 정보처럼 보이지 않도록 합니다.
4. 진료가능과목·대표 특화·운영시간·진료비·고양이 전용 대기실·인증 항목을 **각각** 네이버 플레이스 또는 네이버에 등록된 병원 직접 안내로 재검증합니다.
5. 각 항목마다 직접 출처 URL 또는 사용자 제공 네이버 캡처의 검토 기록과 확인일·확인 범위를 저장합니다. 네이버 캡처가 한 과목만 확인시켰다면 다른 과목은 미확인으로 유지합니다.
6. 외부 서비스와 병원 공식 홈페이지는 정책상 신규 검증 근거로 사용하지 않습니다. 병원 웹사이트 이동용 URL은 증빙 URL과 별도 관리합니다.

## 이번 코드 변경 범위

- 출처 상세에서 비네이버 URL을 근거 링크로 표시하지 않습니다.
- 네이버 검색 링크를 검증된 진료 정보의 출처처럼 명명하지 않도록 바꿉니다.
- 네이버 확인 기록이 없는 진료과목은 기존 데이터를 유지하되 네이버 확인 필요로 구분합니다.
- **65곳의 개별 네이버 재검증, PR 병합 및 운영 배포는 수행하지 않았습니다.**
