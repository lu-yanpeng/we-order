/**
 * 临时验证能力（Story 5.5）：制造一次真实的「微信凭证已失效」，并证明「重试不产生第二个身份」。
 *
 * 仅供验证页使用，Phase 2 结束后随验证页一起删除。三步：
 *  1. 取一次微信一次性凭证，正常提交一次（真实登录消费掉它；响应里的身份就是该 openid
 *     映射到的用户）；
 *  2. 用同一个凭证再提交一次——微信真实返回「凭证已被使用」（40163）或「凭证已过期」
 *     （42003），服务端统一归类为 code_expired_or_used；
 *  3. 清掉本地会话后走正常登录链路重试一次（新的真实微信凭证），得到重试后的身份——
 *     同一 openid 必然映射回同一用户，即「重试不产生第二个身份」。
 */
import { AuthError, supabaseRequest } from './http'
import { LOGIN_PATH, loginCode, type PlatformSession } from './login'
import { clearStoredSessionForVerify, ensureSession } from './session'

export type UsedCodeReplayResult = {
  /** 重放（第二次提交）拿到的真实失效错误 */
  rejection: AuthError
  /** 第一次提交（真实登录）的身份 */
  firstUserId: string
  /** 清掉会话后重试（真实重新登录）的身份 */
  retriedUserId: string
}

/** 执行「重放失效凭证 → 清会话 → 真实重试登录」；失败按 AuthError 抛出 */
export async function verifyUsedCodeReplay(): Promise<UsedCodeReplayResult> {
  const code = await loginCode()
  // 1. 正常消费这张凭证（真实登录）
  const first = await supabaseRequest<PlatformSession>({
    path: LOGIN_PATH,
    method: 'POST',
    body: { code },
  })
  const firstUserId = first.user?.id ?? ''

  // 2. 同一个凭证重放：微信只允许消费一次，这里应拿到真实的「已使用/已过期」
  let rejection: AuthError
  try {
    await supabaseRequest<PlatformSession>({
      path: LOGIN_PATH,
      method: 'POST',
      body: { code },
    })
    // 第二次没有失败：说明「凭证只能用一次」的前提没有成立，明确报出来
    throw new AuthError('unknown', '第二次提交没有失败（预期为凭证已失效）')
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== 'code_expired_or_used') throw error
    rejection = error
  }

  // 3. 重试：清掉本地会话，真实重新登录一次（不产生第二个身份）
  clearStoredSessionForVerify()
  const retriedUserId = (await ensureSession()).userId

  return { rejection, firstUserId, retriedUserId }
}
