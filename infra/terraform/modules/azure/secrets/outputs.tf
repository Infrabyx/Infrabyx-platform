output "provider" {
  value = "azure-keyvault"
}

output "path_prefix" {
  value = var.path_prefix
}

output "key_vault_id" {
  value = azurerm_key_vault.this.id
}

output "key_vault_name" {
  value = azurerm_key_vault.this.name
}
