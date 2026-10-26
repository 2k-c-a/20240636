// 테스트용 결정적 난수(mulberry32). 같은 시드는 항상 같은 값을 만든다.
// 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.
export function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
