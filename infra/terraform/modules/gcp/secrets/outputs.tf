output "provider" {
  value = "gcp-secret-manager"
}

output "path_prefix" {
  value = var.path_prefix
}

output "names" {
  value = { for k, s in google_secret_manager_secret.this : k => s.secret_id }
}
