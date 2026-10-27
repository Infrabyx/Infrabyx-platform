output "host" {
  value = azurerm_redis_cache.this.hostname
}

# Written by the bootstrap (rediss:// with the Entra token flow); see the secrets module.
output "url_secret_path" {
  value = "${var.secrets_path_prefix}-redis-url"
}
