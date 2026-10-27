output "primary_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "url_secret_path" {
  value = aws_secretsmanager_secret.url.name
}
