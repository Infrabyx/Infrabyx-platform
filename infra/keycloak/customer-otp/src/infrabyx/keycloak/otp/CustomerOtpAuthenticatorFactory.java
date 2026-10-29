// Factory for the customer one-time-code step (`ipb-customer-otp`); see CustomerOtpAuthenticator.
package infrabyx.keycloak.otp;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

public final class CustomerOtpAuthenticatorFactory implements AuthenticatorFactory {
  public static final String ID = "ipb-customer-otp";
  private static final CustomerOtpAuthenticator SINGLETON = new CustomerOtpAuthenticator();
  private static final AuthenticationExecutionModel.Requirement[] REQUIREMENTS = {
    AuthenticationExecutionModel.Requirement.REQUIRED
  };

  @Override
  public String getId() {
    return ID;
  }

  @Override
  public Authenticator create(KeycloakSession session) {
    return SINGLETON;
  }

  @Override
  public String getDisplayType() {
    return "Infrabyx customer one-time code";
  }

  @Override
  public String getReferenceCategory() {
    return "otp";
  }

  @Override
  public boolean isConfigurable() {
    return true;
  }

  @Override
  public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
    return REQUIREMENTS;
  }

  @Override
  public boolean isUserSetupAllowed() {
    return false;
  }

  @Override
  public String getHelpText() {
    return "Direct-grant one-time code for customer realms; the platform delivers the code.";
  }

  @Override
  public List<ProviderConfigProperty> getConfigProperties() {
    ProviderConfigProperty ttl = new ProviderConfigProperty();
    ttl.setName(CustomerOtpAuthenticator.TTL);
    ttl.setLabel("Code lifetime (seconds, 60 to 900)");
    ttl.setType(ProviderConfigProperty.STRING_TYPE);
    ttl.setDefaultValue("300");
    ProviderConfigProperty attempts = new ProviderConfigProperty();
    attempts.setName(CustomerOtpAuthenticator.ATTEMPTS);
    attempts.setLabel("Attempts per code (1 to 10)");
    attempts.setType(ProviderConfigProperty.STRING_TYPE);
    attempts.setDefaultValue("5");
    return List.of(ttl, attempts);
  }

  @Override
  public void init(Config.Scope config) {}

  @Override
  public void postInit(KeycloakSessionFactory factory) {}

  @Override
  public void close() {}
}
