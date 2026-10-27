output "host" {
  value = azurerm_postgresql_flexible_server.this.fqdn
}

output "port" {
  value = "5432"
}

output "db" {
  value = var.db_name
}

# Written by the database bootstrap (IPB-02-28); see the secrets module.
output "credentials_secret_path" {
  value = "${var.secrets_path_prefix}-db-app-rw"
}

output "admin_identity_id" {
  value = azurerm_user_assigned_identity.admin.id
}
