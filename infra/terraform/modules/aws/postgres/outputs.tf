output "host" {
  value = aws_db_instance.this.address
}

output "port" {
  value = tostring(aws_db_instance.this.port)
}

output "db" {
  value = var.db_name
}

output "credentials_secret_path" {
  value = aws_secretsmanager_secret.app_rw.name
}
