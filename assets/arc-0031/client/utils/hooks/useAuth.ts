import { useNotifications } from './useNotifications'
import { usePeraWallet } from './usePeraWallet'

import { useEnv } from '@/utils/hooks/useEnv'
import { normalizeError } from '@/utils/normalizeError'

export interface AuthMessage {
  /** The domain name of the Verifier */
  domain: string
  /** Algorand account to authenticate with, encoded as a 32-bytes Algorand address */
  authAcc: string
  /** Unique random challenge generated by the Verifier */
  challenge: string
  /** Algorand network identifier, encoded as a 32-bytes genesis hash of the network */
  chainId: string
  /** Optional, description of the Verifier */
  desc?: string
  /** Optional, metadata */
  meta?: string
}

export interface Session {
  authAcc: string
  accessToken: string
}

export const useAuth = () => {
  const router = useRouter()

  const env = useEnv()

  const { address, connectWallet, disconnectWallet, signData } = usePeraWallet()
  const { showErrorNotification, showWarningNotification, showSuccessNotification } = useNotifications()

  const sessionCookie = useCookie('session', { sameSite: 'strict', maxAge: 60 * 60 * 24 * 365, secure: true })

  const authMessage = ref<AuthMessage | null>(null)
  const isConfirmingSignIn = ref(false)

  const clear = () => {
    disconnectWallet()
    sessionCookie.value = null
    authMessage.value = null
    isConfirmingSignIn.value = false
  }

  const signInAbort = () => {
    clear()
    showWarningNotification('Sign in aborted')
  }

  const signInError = (error: unknown) => {
    clear()
    showErrorNotification(normalizeError(error))
  }

  const prefix = 'arc0031'

  const signIn = async () => {
    try {
      await connectWallet()
      const chainId = env.client.algorandChainId
      const message = await new Arc31ApiClient().request(address.value, chainId)

      if (!(message.substring(0, prefix.length) === prefix)) {
        throw new Error('unexpected prefix')
      }

      // Remove the prefix from the message
      const decodedMessage = message.slice(prefix.length)
      // Parse the remaining JSON part
      authMessage.value = JSON.parse(decodedMessage)
    } catch (error) {
      if ((error as any).data?.type === 'CONNECT_MODAL_CLOSED') {
        signInAbort()
      } else {
        signInError(error)
      }
    }
  }

  const signInConfirm = async () => {
    try {
      isConfirmingSignIn.value = true
      if (!authMessage.value) {
        throw new Error('authMessage is null')
      }
      // Encode the authMessage
      const encodedAuthMessage = prefix + JSON.stringify(authMessage.value)
      // Convert the message string to bytes
      const messageBytes = Buffer.from(encodedAuthMessage, 'utf-8')

      const signMessage = `You are going to login with ${authMessage.value.domain}. Please confirm that you are the owner of this wallet by signing the authentication message.`

      // Sign the message
      const signedMessageBytes = await signData([{ data: messageBytes, message: signMessage }], authMessage.value.authAcc)
      // Convert the signed message to string
      const signedMessageBase64 = Buffer.from(signedMessageBytes[0]).toString('base64')
      // Verify the signed message and update the session cookie
      const session = await new Arc31ApiClient().verify(signedMessageBase64, authMessage.value.authAcc)

      sessionCookie.value = JSON.stringify(session)
      authMessage.value = null
      router.push('/')
      showSuccessNotification('Sign in completed')
    } catch (error) {
      if ((error as any).data?.type === 'SIGN_TRANSACTIONS') {
        signInAbort()
      } else {
        signInError(error)
      }
    }
  }

  const signOut = () => {
    router.push('/signin')
    clear()
    showSuccessNotification('Sign out completed')
  }

  return {
    address,
    authMessage,
    isConfirmingSignIn,
    signInAbort,
    signIn,
    signInConfirm,
    signOut
  }
}
