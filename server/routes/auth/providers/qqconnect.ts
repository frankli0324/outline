import passport from "@outlinewiki/koa-passport";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@out... Remove this comment to see the full error message
import { OAuth2Strategy } from 'passport-oauth';
import Router from "koa-router";
import accountProvisioner from "@server/commands/accountProvisioner";
import env from "@server/env";
import { AuthenticationError } from "@server/errors";
import passportMiddleware from "@server/middlewares/passport";
import { StateStore } from "@server/utils/passport";
import fetch from "fetch-with-proxy";
import util from 'util';

const router = new Router();
const providerName = "qqconnect";
const QQ_CLIENT_ID = process.env.QQ_CLIENT_ID;
const QQ_CLIENT_SECRET = process.env.QQ_CLIENT_SECRET;

export const config = {
  name: "QQ登陆",
  enabled: !!QQ_CLIENT_ID,
};

if (QQ_CLIENT_ID) {
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'options' implicitly has an 'any' type.
  function Strategy(options, verify) {
    options = options || {};
    options.authorizationURL = 'https://graph.qq.com/oauth2.0/authorize';
    options.tokenURL = 'https://graph.qq.com/oauth2.0/token';

    OAuth2Strategy.call(this, options, verify);
    this.name = providerName;
  }
  util.inherits(Strategy, OAuth2Strategy);
  Strategy.prototype.userProfile = async function (accessToken: string, done: any) {
    const profile = await (await fetch(
      "https://graph.qq.com/oauth2.0/me?fmt=json&access_token=" + accessToken
    )).json();
    done(null, profile);
  }
  Strategy.prototype.tokenParams = function (options: object) {
    return { 'fmt': 'json' };
  }

  const strategy = new (Strategy as any)(
    {
      callbackURL: `${env.URL}/auth/qqconnect.callback`,
      clientID: QQ_CLIENT_ID,
      clientSecret: QQ_CLIENT_SECRET,
      useCommonEndpoint: true,
      passReqToCallback: true,
      store: new StateStore(),
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'req' implicitly has an 'any' type.
    async function (req, accessToken, refreshToken, profile, done) {
      try {
        if (profile.error) {
          throw AuthenticationError(
            "Unable to load user profile from QQ Connect API"
          );
        }
        const openid = profile.openid;
        const userInfo = await (await fetch(
          "https://graph.qq.com/user/get_user_info", {
          method: "post",
          headers: {
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: `access_token=${accessToken}&openid=${openid}&oauth_consumer_key=${QQ_CLIENT_ID}`,
        })).json();
        console.log(userInfo);

        const result = await accountProvisioner({
          ip: req.ip,
          team: {
            name: 'MBTI Mafia',
            subdomain: 'mafia.mbti',
          },
          user: {
            name: userInfo.nickname,
            email: `${userInfo.nickname}@mafia.mbti`,
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
        return done(null, result.user, result);
      } catch (err) {
        return done(err, null);
      }
    }
  );
  passport.use(providerName, strategy);

  router.get("qqconnect", passport.authenticate(providerName));

  router.get("qqconnect.callback", passportMiddleware(providerName));
}

export default router;
