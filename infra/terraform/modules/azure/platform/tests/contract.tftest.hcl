# The output contract on Azure (@IPB-01-AT-14, IPB-01-34; PL6 plan §7.3): the platform applies
# against a mock provider (no credentials, no resources) and returns every contract key with the
# declared type, the five bucket classes and the reference regions; other regions need an ADR
# (IPB-01-36).

mock_provider "azurerm" {
  # The mock provider fills computed attributes with random strings; the provider still validates
  # the IDs one resource passes to another, so those resources get well-formed ones.
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id       = "11111111-1111-1111-1111-111111111111"
      object_id       = "22222222-2222-2222-2222-222222222222"
      client_id       = "33333333-3333-3333-3333-333333333333"
      subscription_id = "00000000-0000-0000-0000-000000000000"
    }
  }
  mock_resource "azurerm_resource_group" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod" }
  }
  mock_resource "azurerm_virtual_network" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.Network/virtualNetworks/mock" }
  }
  mock_resource "azurerm_subnet" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.Network/virtualNetworks/mock/subnets/mock" }
  }
  mock_resource "azurerm_network_security_group" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.Network/networkSecurityGroups/mock" }
  }
  mock_resource "azurerm_key_vault" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.KeyVault/vaults/ibx-fbx-prod-kv" }
  }
  mock_resource "azurerm_key_vault_key" {
    defaults = {
      id             = "https://ibx-fbx-prod-kv.vault.azure.net/keys/platform/0123456789abcdef0123456789abcdef"
      versionless_id = "https://ibx-fbx-prod-kv.vault.azure.net/keys/platform"
    }
  }
  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mock"
      principal_id = "44444444-4444-4444-4444-444444444444"
      client_id    = "55555555-5555-5555-5555-555555555555"
      tenant_id    = "11111111-1111-1111-1111-111111111111"
    }
  }
  mock_resource "azurerm_private_dns_zone" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.Network/privateDnsZones/mock.postgres.database.azure.com" }
  }
  mock_resource "azurerm_postgresql_flexible_server" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.DBforPostgreSQL/flexibleServers/infrabyx-fbx-prod" }
  }
  mock_resource "azurerm_redis_cache" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.Cache/redis/infrabyx-fbx-prod" }
  }
  mock_resource "azurerm_storage_account" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.Storage/storageAccounts/ibxfbxprodmock" }
  }
  mock_resource "azurerm_log_analytics_workspace" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.OperationalInsights/workspaces/infrabyx-fbx-prod-aks" }
  }
  mock_resource "azurerm_kubernetes_cluster" {
    defaults = {
      id              = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.ContainerService/managedClusters/infrabyx-fbx-prod"
      oidc_issuer_url = "https://centralindia.oic.prod-aks.azure.com/11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/"
    }
  }
  mock_resource "azurerm_container_registry" {
    defaults = { id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.ContainerRegistry/registries/ibxfbxprodacr" }
  }
}

variables {
  product                   = "fbx"
  env                       = "prod"
  domain                    = "app.example.test"
  regulated_retention_years = 8
}

run "output_contract" {
  command = apply
  variables {
    immutability_locked = true
  }

  assert {
    condition     = output.kubeconfig_ref == "secrets-prod-k8s-kubeconfig"
    error_message = "kubeconfig_ref is the secret name of the kubeconfig"
  }
  assert {
    condition     = alltrue([for k in ["host", "port", "db", "ssl_mode", "credentials_secret_path"] : can(tostring(output.postgres[k]))])
    error_message = "postgres has host, port, db, ssl_mode and credentials_secret_path as strings"
  }
  assert {
    condition     = output.postgres.ssl_mode == "verify-full" && output.postgres.db == "fbx" && output.postgres.port == "5432" && output.postgres.credentials_secret_path == "secrets-prod-db-app-rw"
    error_message = "postgres uses verify-full, the product database and the app-rw secret"
  }
  assert {
    condition     = output.redis.url_secret_path == "secrets-prod-redis-url"
    error_message = "redis.url_secret_path is a secret name"
  }
  assert {
    condition     = toset(keys(output.storage.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "storage.buckets maps every bucket class"
  }
  assert {
    condition     = alltrue([for v in values(output.storage.buckets) : can(regex("^ibxfbxprod[a-z]+$", v)) && length(v) <= 24]) && output.storage.lock_mode == "compliance"
    error_message = "storage account names are valid and carry the prefix, and the lock mode is compliance"
  }
  assert {
    condition     = startswith(output.kms.platform_key_id, "https://")
    error_message = "kms.platform_key_id is the versionless key id"
  }
  assert {
    condition     = output.secrets.provider == "azure-keyvault" && output.secrets.path_prefix == "secrets-prod"
    error_message = "secrets names the provider and the prefix"
  }
  assert {
    condition     = can(tostring(output.edge.zone_id)) && output.edge.origin_hostname == "origin.app.example.test"
    error_message = "edge has the zone id and the origin hostname"
  }
  assert {
    condition     = can(regex("^https?://", output.observability.otlp_endpoint))
    error_message = "observability.otlp_endpoint is a URL"
  }
  assert {
    condition     = can(tostring(output.registry.url)) && output.registry.url != ""
    error_message = "registry.url is a string"
  }
  assert {
    condition     = output.region.primary == "centralindia" && output.region.dr == "southindia"
    error_message = "the reference regions are centralindia and southindia"
  }
}

run "immutability_starts_unlocked" {
  command = plan
  assert {
    condition     = output.storage.lock_mode == "unlocked"
    error_message = "Azure creates the immutability policies unlocked; lock_mode says so until they are locked"
  }
}

run "other_regions_need_an_adr" {
  command = plan
  variables {
    region_primary = "eastus"
    region_dr      = "westus"
  }
  expect_failures = [terraform_data.region_check]
}

run "other_regions_with_an_adr" {
  command = plan
  variables {
    region_primary = "westeurope"
    region_dr      = "northeurope"
    region_adr     = "ADR-0009"
  }
}

run "unknown_product_refused" {
  command = plan
  variables {
    product = "acme"
  }
  expect_failures = [var.product]
}

# Storage compartments (PR-LDC-60, R1-D-158): off by default; when on, each location has its own
# account with its class's controls and its own key, never the platform key or another's.
run "compartments_off_by_default" {
  command = apply

  assert {
    condition     = length(output.storage.compartments) == 0 && length(module.kms.compartment_key_ids) == 0
    error_message = "no compartment account or key unless storage_compartments asks for one"
  }
  assert {
    condition     = toset(keys(output.storage.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "storage.buckets still maps exactly the five classes"
  }
}

run "compartments_on" {
  command = apply
  variables {
    storage_compartments = [
      { class = "CONFIDENTIAL", compartment = "BOARD_CONFIDENTIAL" },
      { class = "CONFIDENTIAL", compartment = "SEALED" },
      { class = "REGULATED", compartment = "BOARD_CONFIDENTIAL" },
      { class = "REGULATED", compartment = "SEALED" },
    ]
  }
  # The mock gives every key one id; real keys are distinct resources, so each gets its own here.
  override_resource {
    target = module.kms.azurerm_key_vault_key.compartment["CONFIDENTIAL.BOARD_CONFIDENTIAL"]
    values = {
      id             = "https://ibx-fbx-prod-kv.vault.azure.net/keys/conf-board/0123456789abcdef0123456789abcdef"
      versionless_id = "https://ibx-fbx-prod-kv.vault.azure.net/keys/conf-board"
    }
  }
  override_resource {
    target = module.kms.azurerm_key_vault_key.compartment["CONFIDENTIAL.SEALED"]
    values = {
      id             = "https://ibx-fbx-prod-kv.vault.azure.net/keys/conf-sealed/0123456789abcdef0123456789abcdef"
      versionless_id = "https://ibx-fbx-prod-kv.vault.azure.net/keys/conf-sealed"
    }
  }
  override_resource {
    target = module.kms.azurerm_key_vault_key.compartment["REGULATED.BOARD_CONFIDENTIAL"]
    values = {
      id             = "https://ibx-fbx-prod-kv.vault.azure.net/keys/reg-board/0123456789abcdef0123456789abcdef"
      versionless_id = "https://ibx-fbx-prod-kv.vault.azure.net/keys/reg-board"
    }
  }
  override_resource {
    target = module.kms.azurerm_key_vault_key.compartment["REGULATED.SEALED"]
    values = {
      id             = "https://ibx-fbx-prod-kv.vault.azure.net/keys/reg-sealed/0123456789abcdef0123456789abcdef"
      versionless_id = "https://ibx-fbx-prod-kv.vault.azure.net/keys/reg-sealed"
    }
  }

  assert {
    condition = { for s, c in output.storage.compartments : s => c.bucket } == {
      "CONFIDENTIAL.BOARD_CONFIDENTIAL" = "ibxfbxprodconfb"
      "CONFIDENTIAL.SEALED"             = "ibxfbxprodconfs"
      "REGULATED.BOARD_CONFIDENTIAL"    = "ibxfbxprodregb"
      "REGULATED.SEALED"                = "ibxfbxprodregs"
    }
    error_message = "each location has its own storage account, named <compact><class><b or s>"
  }
  assert {
    condition     = length(setintersection(toset([for c in values(output.storage.compartments) : c.bucket]), toset(values(output.storage.buckets)))) == 0
    error_message = "no compartment account is a class account"
  }
  assert {
    condition = (
      length(distinct([for c in values(output.storage.compartments) : c.key_id])) == 4 &&
      !contains([for c in values(output.storage.compartments) : c.key_id], output.kms.platform_key_id)
    )
    error_message = "every location has its own key, never the platform key"
  }
}

run "compartment_in_general_refused" {
  command = plan
  variables {
    storage_compartments = [{ class = "GENERAL", compartment = "SEALED" }]
  }
  expect_failures = [var.storage_compartments]
}

run "unknown_compartment_refused" {
  command = plan
  variables {
    storage_compartments = [{ class = "CONFIDENTIAL", compartment = "PRIVATE" }]
  }
  expect_failures = [var.storage_compartments]
}

run "compartment_given_twice_refused" {
  command = plan
  variables {
    storage_compartments = [
      { class = "REGULATED", compartment = "SEALED" },
      { class = "REGULATED", compartment = "SEALED" },
    ]
  }
  expect_failures = [var.storage_compartments]
}

# The compartment accounts' controls, on the object_storage module itself (its resources are not
# visible from the platform's runs).
run "object_storage_compartment_controls" {
  command = apply
  module {
    source = "../object_storage"
  }
  providers = {
    azurerm = azurerm
  }
  variables {
    name                = "infrabyx-ldc-prod"
    resource_group_name = "infrabyx-ldc-prod"
    location            = "centralindia"
    key_id              = "https://ibx-ldc-prod-kv.vault.azure.net/keys/platform"
    cmk_identity_id     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-ldc-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mock"
    allowed_subnet_ids  = ["/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-ldc-prod/providers/Microsoft.Network/virtualNetworks/mock/subnets/mock"]
    retention_years     = { REGULATED = 10 }
    immutability_locked = true
    storage_compartments = [
      { class = "CONFIDENTIAL", compartment = "BOARD_CONFIDENTIAL" },
      { class = "REGULATED", compartment = "SEALED" },
    ]
    compartment_key_ids = {
      "CONFIDENTIAL.BOARD_CONFIDENTIAL" = "https://ibx-ldc-prod-kv.vault.azure.net/keys/conf-board"
      "REGULATED.SEALED"                = "https://ibx-ldc-prod-kv.vault.azure.net/keys/reg-sealed"
    }
  }

  assert {
    condition     = output.compartments["CONFIDENTIAL.BOARD_CONFIDENTIAL"].bucket == "ibxldcprodconfb" && output.compartments["REGULATED.SEALED"].bucket == "ibxldcprodregs"
    error_message = "compartment accounts are named <compact><class><b or s>"
  }
  assert {
    condition = alltrue([for s, c in output.compartments :
      c.key_id == var.compartment_key_ids[s] &&
      azurerm_storage_account.this[s].customer_managed_key[0].key_vault_key_id == var.compartment_key_ids[s] &&
      azurerm_storage_account.this[s].customer_managed_key[0].user_assigned_identity_id == var.cmk_identity_id
    ])
    error_message = "each compartment account is encrypted with its own key through the CMK identity, which compartments returns"
  }
  assert {
    condition     = alltrue([for c in ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"] : azurerm_storage_account.this[c].customer_managed_key[0].key_vault_key_id == var.key_id])
    error_message = "the class accounts keep the platform key"
  }
  assert {
    condition = (
      azurerm_storage_account.this["CONFIDENTIAL.BOARD_CONFIDENTIAL"].immutability_policy[0].period_since_creation_in_days == 365 &&
      azurerm_storage_account.this["REGULATED.SEALED"].immutability_policy[0].period_since_creation_in_days == 3650 &&
      alltrue([for s in keys(output.compartments) : azurerm_storage_account.this[s].immutability_policy[0].state == "Locked" && !azurerm_storage_account.this[s].immutability_policy[0].allow_protected_append_writes])
    )
    error_message = "each compartment account has its class's immutability period, locked with the class accounts"
  }
  assert {
    condition = alltrue([for s in keys(output.compartments) :
      azurerm_storage_account.this[s].account_replication_type == "GZRS" &&
      azurerm_storage_account.this[s].min_tls_version == "TLS1_2" && azurerm_storage_account.this[s].https_traffic_only_enabled &&
      !azurerm_storage_account.this[s].allow_nested_items_to_be_public && !azurerm_storage_account.this[s].shared_access_key_enabled &&
      !azurerm_storage_account.this[s].cross_tenant_replication_enabled && azurerm_storage_account.this[s].infrastructure_encryption_enabled &&
      azurerm_storage_account.this[s].network_rules[0].default_action == "Deny" &&
      azurerm_storage_account.this[s].blob_properties[0].versioning_enabled &&
      azurerm_storage_container.objects[s].container_access_type == "private" &&
      azurerm_management_lock.this[s].lock_level == "CanNotDelete"
    ])
    error_message = "each compartment account is geo-zone-redundant, TLS 1.2 and HTTPS only, Entra ID only, firewalled, versioned, private and delete-locked"
  }
  assert {
    condition     = toset(keys(output.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "buckets still maps the five classes only"
  }
}

run "object_storage_compartment_on_the_platform_key_refused" {
  command = plan
  module {
    source = "../object_storage"
  }
  providers = {
    azurerm = azurerm
  }
  variables {
    name                 = "infrabyx-ldc-prod"
    resource_group_name  = "infrabyx-ldc-prod"
    location             = "centralindia"
    key_id               = "https://ibx-ldc-prod-kv.vault.azure.net/keys/platform"
    cmk_identity_id      = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-ldc-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mock"
    allowed_subnet_ids   = ["/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-ldc-prod/providers/Microsoft.Network/virtualNetworks/mock/subnets/mock"]
    retention_years      = { REGULATED = 10 }
    storage_compartments = [{ class = "CONFIDENTIAL", compartment = "SEALED" }]
    compartment_key_ids  = { "CONFIDENTIAL.SEALED" = "https://ibx-ldc-prod-kv.vault.azure.net/keys/platform" }
  }
  expect_failures = [terraform_data.compartment_keys]
}

run "object_storage_compartment_without_a_key_refused" {
  command = plan
  module {
    source = "../object_storage"
  }
  providers = {
    azurerm = azurerm
  }
  variables {
    name                 = "infrabyx-ldc-prod"
    resource_group_name  = "infrabyx-ldc-prod"
    location             = "centralindia"
    key_id               = "https://ibx-ldc-prod-kv.vault.azure.net/keys/platform"
    cmk_identity_id      = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-ldc-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mock"
    allowed_subnet_ids   = ["/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-ldc-prod/providers/Microsoft.Network/virtualNetworks/mock/subnets/mock"]
    retention_years      = { REGULATED = 10 }
    storage_compartments = [{ class = "REGULATED", compartment = "BOARD_CONFIDENTIAL" }]
  }
  expect_failures = [var.compartment_key_ids]
}

# The compartment keys, on the kms module itself: the platform key's kind, in the primary vault.
run "kms_compartment_keys" {
  command = apply
  module {
    source = "../kms"
  }
  providers = {
    azurerm = azurerm
  }
  variables {
    name                = "infrabyx-ldc-prod"
    resource_group_name = "infrabyx-ldc-prod"
    location            = "centralindia"
    location_dr         = "southindia"
    allowed_subnet_ids  = ["/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-ldc-prod/providers/Microsoft.Network/virtualNetworks/mock/subnets/mock"]
    compartments        = ["CONFIDENTIAL.BOARD_CONFIDENTIAL", "REGULATED.SEALED"]
  }

  assert {
    condition = alltrue([for s, k in azurerm_key_vault_key.compartment :
      k.key_vault_id == azurerm_key_vault.this["primary"].id && k.key_type == "RSA-HSM" && k.key_size == 3072 &&
      toset(k.key_opts) == toset(["wrapKey", "unwrapKey"]) && k.rotation_policy[0].automatic[0].time_after_creation == "P1Y" &&
      k.tags["compartment"] == s
    ]) && length(azurerm_key_vault_key.compartment) == 2
    error_message = "each compartment key is an RSA-HSM 3072 wrap key in the primary vault, rotated yearly, like the platform key"
  }
  assert {
    condition     = azurerm_key_vault_key.compartment["CONFIDENTIAL.BOARD_CONFIDENTIAL"].name == "conf-board" && azurerm_key_vault_key.compartment["REGULATED.SEALED"].name == "reg-sealed"
    error_message = "each compartment key is named after its location"
  }
}
