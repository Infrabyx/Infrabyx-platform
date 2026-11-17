# Class => storage account; each holds the container `objects`.
output "buckets" {
  value = { for c in local.classes : c => azurerm_storage_account.this[c].name }
}

# compliance once the policies are locked; until then the STORAGE adapter treats the locked
# classes as not yet writable.
output "lock_mode" {
  value = var.immutability_locked ? "compliance" : "unlocked"
}

# PR-LDC-60: "<CLASS>.<COMPARTMENT>" => its account (container `objects`) and key, for the
# settings int.storage.bucket.<class>.<compartment> and the adapter's compartment keys. Empty when off.
output "compartments" {
  value = { for s in keys(local.cmp) : s => { bucket = azurerm_storage_account.this[s].name, key_id = local.key_of[s] } }
}
