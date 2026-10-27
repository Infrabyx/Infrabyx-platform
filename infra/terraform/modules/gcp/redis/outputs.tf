output "host" {
  value = google_redis_instance.this.host
}

# Written by the bootstrap (rediss:// with the AUTH string); see the secrets module.
output "url_secret_path" {
  value = "${var.secrets_path_prefix}-redis-url"
}
