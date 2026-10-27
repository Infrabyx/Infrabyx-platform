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
