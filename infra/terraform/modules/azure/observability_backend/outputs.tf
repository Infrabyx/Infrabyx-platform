output "otlp_endpoint" {
  value = var.collector_endpoint
}

output "telemetry_bucket" {
  value = azurerm_storage_account.telemetry.name
}
