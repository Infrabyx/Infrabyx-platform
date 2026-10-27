# The output contract on GCP (@IPB-01-AT-14, IPB-01-34; PL6 plan §7.3): the platform applies
# against a mock provider (no credentials, no resources) and returns every contract key with the
# declared type, the five bucket classes and the reference regions; other regions need an ADR
# (IPB-01-36).

mock_provider "google" {
  # The mock provider fills computed attributes with random strings; the IDs and emails one
  # resource passes to another get well-formed values.
  mock_data "google_client_config" {
    defaults = {
      project = "infrabyx-mock"
      region  = "asia-south1"
      zone    = "asia-south1-a"
    }
  }
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_compute_network" {
    defaults = {
      id        = "projects/infrabyx-mock/global/networks/mock"
      self_link = "https://www.googleapis.com/compute/v1/projects/infrabyx-mock/global/networks/mock"
    }
  }
  mock_resource "google_compute_subnetwork" {
    defaults = {
      id        = "projects/infrabyx-mock/regions/asia-south1/subnetworks/mock"
      self_link = "https://www.googleapis.com/compute/v1/projects/infrabyx-mock/regions/asia-south1/subnetworks/mock"
    }
  }
  mock_resource "google_kms_key_ring" {
    defaults = { id = "projects/infrabyx-mock/locations/asia-south1/keyRings/mock" }
  }
  mock_resource "google_kms_crypto_key" {
    defaults = { id = "projects/infrabyx-mock/locations/asia-south1/keyRings/mock/cryptoKeys/platform" }
  }
  mock_resource "google_service_account" {
    defaults = {
      email  = "workload-mock@infrabyx-mock.iam.gserviceaccount.com"
      name   = "projects/infrabyx-mock/serviceAccounts/workload-mock@infrabyx-mock.iam.gserviceaccount.com"
      member = "serviceAccount:workload-mock@infrabyx-mock.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_container_cluster" {
    defaults = { id = "projects/infrabyx-mock/locations/asia-south1/clusters/infrabyx-fbx-prod" }
  }
  mock_resource "google_sql_database_instance" {
    defaults = {
      private_ip_address = "10.50.0.3"
      connection_name    = "infrabyx-mock:asia-south1:infrabyx-fbx-prod"
    }
  }
  mock_resource "google_redis_instance" {
    defaults = { host = "10.50.1.4" }
  }
  mock_resource "google_dns_managed_zone" {
    defaults = { id = "projects/infrabyx-mock/managedZones/infrabyx-fbx-prod" }
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

  assert {
    condition     = output.kubeconfig_ref == "secrets-prod-k8s-kubeconfig"
    error_message = "kubeconfig_ref is the secret id of the kubeconfig"
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
    error_message = "redis.url_secret_path is a secret id"
  }
  assert {
    condition     = toset(keys(output.storage.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "storage.buckets maps every bucket class"
  }
  assert {
    condition     = alltrue([for v in values(output.storage.buckets) : can(regex("^infrabyx-fbx-prod-", v))]) && output.storage.lock_mode == "compliance"
    error_message = "bucket names carry the name prefix and the lock mode is compliance"
  }
  assert {
    condition     = startswith(output.kms.platform_key_id, "projects/")
    error_message = "kms.platform_key_id is the crypto key id"
  }
  assert {
    condition     = output.secrets.provider == "gcp-secret-manager" && output.secrets.path_prefix == "secrets-prod"
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
    condition     = output.registry.url == "asia-south1-docker.pkg.dev/infrabyx-mock/infrabyx-fbx-prod-images"
    error_message = "registry.url is the Artifact Registry Docker host and repository"
  }
  assert {
    condition     = output.region.primary == "asia-south1" && output.region.dr == "asia-south2"
    error_message = "the reference regions are asia-south1 and asia-south2"
  }
}

run "other_regions_need_an_adr" {
  command = plan
  variables {
    region_primary = "us-central1"
    region_dr      = "us-east1"
    azs            = ["us-central1-a", "us-central1-b", "us-central1-c"]
  }
  expect_failures = [terraform_data.region_check]
}

run "other_regions_with_an_adr" {
  command = plan
  variables {
    region_primary = "europe-west1"
    region_dr      = "europe-west4"
    region_adr     = "ADR-0009"
    azs            = ["europe-west1-b", "europe-west1-c", "europe-west1-d"]
    multi_region   = "eu"
  }
}

run "unknown_product_refused" {
  command = plan
  variables {
    product = "acme"
  }
  expect_failures = [var.product]
}
