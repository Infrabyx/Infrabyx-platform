output "platform_key_id" {
  description = "Versionless key id, so that encrypting services follow the rotation"
  value       = azurerm_key_vault_key.platform["primary"].versionless_id
}

output "dr_key_id" {
  value = azurerm_key_vault_key.platform["dr"].versionless_id
}

output "key_vault_id" {
  value = azurerm_key_vault.this["primary"].id
}

output "cmk_identity_id" {
  value = azurerm_user_assigned_identity.cmk.id
}

output "cmk_identity_client_id" {
  value = azurerm_user_assigned_identity.cmk.client_id
}

output "tenant_id" {
  value = data.azurerm_client_config.current.tenant_id
}

# PR-LDC-60: "<CLASS>.<COMPARTMENT>" => versionless key id (empty when off).
output "compartment_key_ids" {
  value = { for s, k in azurerm_key_vault_key.compartment : s => k.versionless_id }
}
