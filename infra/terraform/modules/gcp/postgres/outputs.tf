output "host" {
  value = google_sql_database_instance.this.private_ip_address
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

output "connection_name" {
  value = google_sql_database_instance.this.connection_name
}
