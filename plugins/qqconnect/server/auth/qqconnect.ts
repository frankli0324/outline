import crypto from "crypto";
import passport from "@outlinewiki/koa-passport";
import type { Context } from "koa";
import Router from "koa-router";
import { Strategy } from "passport-oauth2";
import accountProvisioner from "@server/commands/accountProvisioner";
import env from "@server/env";
import { AuthenticationError } from "@server/errors";
import passportMiddleware from "@server/middlewares/passport";
import { User } from "@server/models";
import { AuthenticationResult } from "@server/types";
import {
  StateStore,
  request,
  getTeamFromContext,
  getClientFromContext,
} from "@server/utils/passport";

const router = new Router();
const providerName = "qqconnect";

const QQ_CLIENT_ID = env.QQ_CLIENT_ID;
const QQ_CLIENT_SECRET = env.QQ_CLIENT_SECRET;
const QQ_SUBDOMAIN = env.QQ_SUBDOMAIN;

Strategy.prototype.userProfile = async function (accessToken, done) {
  try {
    const profile = await (await fetch(
      "https://graph.qq.com/oauth2.0/me?fmt=json&access_token=" + accessToken
    )).json();
    done(null, profile);
  } catch (err) {
    return done(err);
  }
};

Strategy.prototype.tokenParams = function (_options: object) {
  return { 'fmt': 'json' };
}

if (QQ_CLIENT_ID && QQ_CLIENT_SECRET) {
  passport.use(
    providerName,
    new Strategy(
      {
        authorizationURL: "https://graph.qq.com/oauth2.0/authorize",
        tokenURL: "https://graph.qq.com/oauth2.0/token",
        clientID: QQ_CLIENT_ID,
        clientSecret: QQ_CLIENT_SECRET,
        callbackURL: `${env.URL}/auth/${providerName}.callback`,
        passReqToCallback: true,
        scope: [],
        // @ts-expect-error custom state store
        store: new StateStore(),
        state: true,
        pkce: false,
      },
      // OpenID Connect standard profile claims can be found in the official
      // specification.
      // https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
      // Non-standard claims may be configured by individual identity providers.
      // Any claim supplied in response to the userinfo request will be
      // available on the `profile` parameter
      async function (
        ctx: Context,
        accessToken: string,
        refreshToken: string,
        params: { expires_in: number },
        profile: Record<string, string>,
        done: (
          err: Error | null,
          user: User | null,
          result?: AuthenticationResult
        ) => void
      ) {
        try {
          if (profile.error) {
            throw AuthenticationError(
              "Unable to load user profile from QQ Connect API"
            );
          }
          const team = await getTeamFromContext(ctx);
          const client = getClientFromContext(ctx);
          const openid = profile.openid;
          const userInfo = await (
            await fetch("https://graph.qq.com/user/get_user_info", {
              method: "post",
              headers: {
                "content-type": "application/x-www-form-urlencoded",
              },
              body: `access_token=${accessToken}&openid=${openid}&oauth_consumer_key=${QQ_CLIENT_ID}`,
            })
          ).json();
          console.log(userInfo);
          const hash = crypto
            .createHash("md5")
            .update(userInfo.nickname)
            .digest("hex");

          const result = await accountProvisioner({
            ip: ctx.ip,
            team: {
              teamId: team?.id,
              name: "MBTI Mafia",
              subdomain: QQ_SUBDOMAIN,
            },
            user: {
              name: userInfo.nickname,
              email: `${hash}@${QQ_SUBDOMAIN}`,
              avatarUrl: userInfo.figureurl_qq_1,
            },
            authenticationProvider: {
              name: providerName,
              providerId: "mafia.mbti",
            },
            authentication: {
              providerId: openid,
              accessToken,
              refreshToken,
              scopes: [],
            },
          });
          return done(null, result.user, { ...result, client });
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );

  router.get(providerName, passport.authenticate(providerName));

  router.get(`${providerName}.callback`, passportMiddleware(providerName));
}

export const name = "QQ登陆";

export default router;
