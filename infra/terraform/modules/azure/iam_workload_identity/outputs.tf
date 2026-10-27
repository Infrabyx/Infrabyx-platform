# Service account => client id, for the azure.workload.identity/client-id annotation.
output "client_ids" {
  value = { for sa, i in azurerm_user_assigned_identity.this : sa => i.client_id }
}
