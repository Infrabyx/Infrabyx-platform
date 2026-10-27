# Class => storage account; each holds the container `objects`.
output "buckets" {
  value = { for c, a in azurerm_storage_account.this : c => a.name }
}

# compliance once the policies are locked; until then the STORAGE adapter treats the locked
# classes as not yet writable.
output "lock_mode" {
  value = var.immutability_locked ? "compliance" : "unlocked"
}
