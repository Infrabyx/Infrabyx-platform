locals {
  extra = merge([
    # Keyed by position, as on AWS.
    for sa, roles in var.workloads : { for i, r in roles : "${sa}|${i}" => { sa = sa, role = r } }
  ]...)
}

# One identity per service account, trusted only for that service account's token (workload
# identity federation), with read access to this environment's secrets vault (IPB-02-28).
resource "azurerm_user_assigned_identity" "this" {
  for_each            = var.workloads
  name                = "${var.name}-${each.key}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_federated_identity_credential" "this" {
  for_each                  = var.workloads
  name                      = each.key
  user_assigned_identity_id = azurerm_user_assigned_identity.this[each.key].id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = var.oidc_issuer
  subject                   = "system:serviceaccount:${var.namespace}:${each.key}"
}

resource "azurerm_role_assignment" "secrets" {
  for_each             = var.workloads
  scope                = var.secrets_vault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.this[each.key].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "extra" {
  for_each             = local.extra
  scope                = var.role_scope
  role_definition_name = each.value.role
  principal_id         = azurerm_user_assigned_identity.this[each.value.sa].principal_id
  principal_type       = "ServicePrincipal"
}
