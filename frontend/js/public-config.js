// GET /api/config로 공개 설정(Supabase URL·Publishable key·앱 주소)을 읽는다. Secret key는 이 응답에 없다.

export const DISABLED_CONFIG = Object.freeze({ enabled: false, url: null, key: null, appOrigin: null });

/** 응답을 검사해 쓸 수 있는 설정만 돌려준다. 형식이 이상하면 비활성으로 본다. */
export function parsePublicConfig(data) {
    if (!data || typeof data !== 'object' || data.auth_enabled !== true) return DISABLED_CONFIG;
    const { supabase_url: url, supabase_publishable_key: key, app_origin: appOrigin } = data;
    if (![url, key, appOrigin].every((v) => typeof v === 'string' && v !== '')) return DISABLED_CONFIG;
    return Object.freeze({ enabled: true, url, key, appOrigin });
}

/** 설정을 읽지 못하면(서버 오류·네트워크) `{...DISABLED_CONFIG, failed: true}`를 돌려준다. */
export async function loadPublicConfig(fetchFn = globalThis.fetch, signal) {
    try {
        const response = await fetchFn('/api/config', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
        if (!response.ok) return { ...DISABLED_CONFIG, failed: true };
        return parsePublicConfig(await response.json());
    } catch {
        return { ...DISABLED_CONFIG, failed: true };
    }
}
