// One-time-code first factor for Infrabyx customer realms (OWNER-QUESTIONS #84 (b), R1-D-19).
// Runs in a direct-grant flow after `direct-grant-validate-username`, for confidential clients
// marked `ipb.customer.otp=true` only. Two steps on the token endpoint:
//   ipb_otp_step=send    -> a fresh code and challenge id, returned to the authenticated client
//                           (the platform delivers it through NOTIFY); only a SHA-256 hash of
//                           "<challenge>:<code>" is kept, in the single-use store, for `ttl` seconds.
//   ipb_otp_step=verify  -> ipb_otp_challenge + ipb_otp_code; at most `attempts` tries per code,
//                           compared in constant time; a success consumes the challenge.
// The code is never logged and never stored in clear. Rate limits and lockouts per account are
// enforced by the platform before it calls this step, and Keycloak's brute-force protector counts
// each refused code as a failed login.
package infrabyx.keycloak.otp;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.regex.Pattern;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.SingleUseObjectProvider;
import org.keycloak.models.UserModel;

public final class CustomerOtpAuthenticator implements Authenticator {
  static final String CLIENT_ATTRIBUTE = "ipb.customer.otp";
  static final String TTL = "ttl";
  static final String ATTEMPTS = "attempts";
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Pattern CHALLENGE = Pattern.compile("^[A-Za-z0-9_-]{22}$");
  private static final Pattern CODE = Pattern.compile("^[0-9]{6}$");

  @Override
  public void authenticate(AuthenticationFlowContext context) {
    ClientModel client = context.getAuthenticationSession().getClient();
    UserModel user = context.getUser();
    if (client == null
        || client.isPublicClient()
        || !"true".equals(client.getAttribute(CLIENT_ATTRIBUTE))) {
      refuse(context, AuthenticationFlowError.CLIENT_DISABLED, "unauthorized_client");
      return;
    }
    if (user == null) {
      refuse(context, AuthenticationFlowError.INVALID_USER, "invalid_grant");
      return;
    }
    String step = context.getHttpRequest().getDecodedFormParameters().getFirst("ipb_otp_step");
    if ("send".equals(step)) send(context, client, user);
    else if ("verify".equals(step)) verify(context, client, user);
    else refuse(context, AuthenticationFlowError.INVALID_CREDENTIALS, "invalid_request");
  }

  private void send(AuthenticationFlowContext context, ClientModel client, UserModel user) {
    long ttl = setting(context, TTL, 300, 60, 900);
    byte[] id = new byte[16];
    RANDOM.nextBytes(id);
    String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(id);
    String code = String.format("%06d", RANDOM.nextInt(1_000_000));
    Map<String, String> notes = new HashMap<>();
    notes.put("u", user.getId());
    notes.put("c", client.getId());
    notes.put("h", digest(challenge, code));
    notes.put("n", "0");
    store(context).put(key(context.getRealm(), challenge), ttl, notes);
    String body =
        "{\"ipb_otp_challenge\":\""
            + challenge
            + "\",\"ipb_otp_code\":\""
            + code
            + "\",\"expires_in\":"
            + ttl
            + "}";
    context.challenge(
        Response.status(Response.Status.ACCEPTED)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .header("Cache-Control", "no-store")
            .entity(body)
            .build());
  }

  private void verify(AuthenticationFlowContext context, ClientModel client, UserModel user) {
    var form = context.getHttpRequest().getDecodedFormParameters();
    String challenge = form.getFirst("ipb_otp_challenge");
    String code = form.getFirst("ipb_otp_code");
    if (challenge == null || code == null || !CHALLENGE.matcher(challenge).matches()) {
      refuse(context, AuthenticationFlowError.INVALID_CREDENTIALS, "invalid_grant");
      return;
    }
    SingleUseObjectProvider store = store(context);
    String key = key(context.getRealm(), challenge);
    Map<String, String> notes = store.get(key);
    if (notes == null
        || !user.getId().equals(notes.get("u"))
        || !client.getId().equals(notes.get("c"))) {
      refuse(context, AuthenticationFlowError.EXPIRED_CODE, "invalid_grant");
      return;
    }
    long attempts = setting(context, ATTEMPTS, 5, 1, 10);
    int tries = Integer.parseInt(notes.getOrDefault("n", "0")) + 1;
    boolean match =
        CODE.matcher(code).matches()
            && MessageDigest.isEqual(
                digest(challenge, code).getBytes(StandardCharsets.US_ASCII),
                notes.get("h").getBytes(StandardCharsets.US_ASCII));
    if (match) {
      // Single use: only the request that removes the challenge succeeds.
      if (store.remove(key) == null) {
        refuse(context, AuthenticationFlowError.EXPIRED_CODE, "invalid_grant");
        return;
      }
      context.success();
      return;
    }
    if (tries >= attempts) store.remove(key);
    else {
      Map<String, String> next = new HashMap<>(notes);
      next.put("n", Integer.toString(tries));
      store.replace(key, next);
    }
    refuse(context, AuthenticationFlowError.INVALID_CREDENTIALS, "invalid_grant");
  }

  private static void refuse(
      AuthenticationFlowContext context, AuthenticationFlowError error, String oauthError) {
    context
        .getEvent()
        .user(context.getUser())
        .error(error.name().toLowerCase());
    context.failure(
        error,
        Response.status(Response.Status.UNAUTHORIZED)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .header("Cache-Control", "no-store")
            .entity("{\"error\":\"" + oauthError + "\",\"error_description\":\"" + error.name().toLowerCase() + "\"}")
            .build());
  }

  private static long setting(
      AuthenticationFlowContext context, String name, long fallback, long min, long max) {
    AuthenticatorConfigModel config = context.getAuthenticatorConfig();
    String raw = config == null ? null : config.getConfig().get(name);
    long value;
    try {
      value = raw == null ? fallback : Long.parseLong(raw);
    } catch (NumberFormatException e) {
      value = fallback;
    }
    return Math.max(min, Math.min(max, value));
  }

  private static SingleUseObjectProvider store(AuthenticationFlowContext context) {
    return context.getSession().singleUseObjects();
  }

  private static String key(RealmModel realm, String challenge) {
    return "ipb-otp:" + realm.getId() + ":" + challenge;
  }

  static String digest(String challenge, String code) {
    try {
      byte[] h =
          MessageDigest.getInstance("SHA-256")
              .digest((challenge + ":" + code).getBytes(StandardCharsets.US_ASCII));
      return HexFormat.of().formatHex(h);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  @Override
  public void action(AuthenticationFlowContext context) {
    authenticate(context);
  }

  @Override
  public boolean requiresUser() {
    return true;
  }

  @Override
  public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
    return true;
  }

  @Override
  public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {}

  @Override
  public void close() {}
}
