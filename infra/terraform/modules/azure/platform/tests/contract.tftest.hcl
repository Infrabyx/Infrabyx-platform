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
      kubelet_identity = [{
        client_id                 = "77777777-7777-7777-7777-777777777777"
        object_id                 = "88888888-8888-8888-8888-888888888888"
        user_assigned_identity_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/infrabyx-fbx-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/kubelet"
      }]
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
