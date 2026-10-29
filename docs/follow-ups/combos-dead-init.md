`lib/ventilation/simulate.ts`의 `searchWindowCombinations`에서 `combos`를 `[{A:0,B:0}]`로 만든 직후 `combos.length = 0`으로 비운다. 동작에는 영향이 없는 죽은 초기화이므로, 배열을 빈 값으로 선언하도록 정리한다(코드 리뷰 low, 수정 보류).
