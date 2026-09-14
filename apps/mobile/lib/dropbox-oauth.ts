import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { DropboxAuthTokens } from './dropbox-auth';
import { DROPBOX_NATIVE_REDIRECT_URI } from './dropbox-auth-callback';

const DROPBOX_DISCOVERY = {
    authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize',
    tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
};

const ACCESS_SCOPES = [
    'files.content.read',
    'files.content.write',
    'files.metadata.read',
];

const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 4 * 60 * 60;

const ensureDropboxClientId = (clientId: string): string => {
    const trimmed = clientId.trim();
    if (!trimmed) {
        throw new Error('Dropbox app key is not configured');
    }
    return trimmed;
};

export const getDropboxRedirectUri = (): string => AuthSession.makeRedirectUri({
    scheme: 'mindwtr',
    path: 'redirect',
    native: DROPBOX_NATIVE_REDIRECT_URI,
});

export async function authorizeDropbox(clientId: string): Promise<DropboxAuthTokens> {
    const resolvedClientId = ensureDropboxClientId(clientId);
    WebBrowser.maybeCompleteAuthSession();

    const redirectUri = getDropboxRedirectUri();
    const request = new AuthSession.AuthRequest({
        clientId: resolvedClientId,
        redirectUri,
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
        scopes: ACCESS_SCOPES,
        extraParams: {
            token_access_type: 'offline',
        },
    });

    const result = await request.promptAsync(DROPBOX_DISCOVERY);
    if (result.type !== 'success' || !result.params?.code) {
        throw new Error('Dropbox authorization failed');
    }
    if (!request.codeVerifier) {
        throw new Error('Dropbox authorization failed: PKCE verifier missing');
    }

    const tokenResult = await AuthSession.exchangeCodeAsync(
        {
            clientId: resolvedClientId,
            code: result.params.code,
            redirectUri,
            extraParams: {
                code_verifier: request.codeVerifier,
            },
        },
        DROPBOX_DISCOVERY
    );

    const accessToken = tokenResult.accessToken?.trim() ?? '';
    const refreshToken = tokenResult.refreshToken?.trim() ?? '';
    const expiresInSeconds = tokenResult.expiresIn ?? DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;
    if (!accessToken || !refreshToken || !Number.isFinite(expiresInSeconds)) {
        throw new Error('Dropbox token exchange returned an invalid response');
    }

    const tokens: DropboxAuthTokens = {
        accessToken,
        refreshToken,
        expiresAt: Date.now() + expiresInSeconds * 1000,
    };
    return tokens;
}
