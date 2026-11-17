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

# Storage compartments (PR-LDC-60, R1-D-158): off by default; when on, each location has its own
# bucket with its class's controls and its own key, never a platform key or another's.
run "compartments_off_by_default" {
  command = apply

  assert {
    condition     = length(output.storage.compartments) == 0 && length(module.kms.compartment_key_ids) == 0
    error_message = "no compartment bucket or key unless storage_compartments asks for one"
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
    target = module.kms.google_kms_crypto_key.compartment["CONFIDENTIAL.BOARD_CONFIDENTIAL"]
    values = { id = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-fbx-prod-geo/cryptoKeys/conf-board" }
  }
  override_resource {
    target = module.kms.google_kms_crypto_key.compartment["CONFIDENTIAL.SEALED"]
    values = { id = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-fbx-prod-geo/cryptoKeys/conf-sealed" }
  }
  override_resource {
    target = module.kms.google_kms_crypto_key.compartment["REGULATED.BOARD_CONFIDENTIAL"]
    values = { id = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-fbx-prod-geo/cryptoKeys/reg-board" }
  }
  override_resource {
    target = module.kms.google_kms_crypto_key.compartment["REGULATED.SEALED"]
    values = { id = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-fbx-prod-geo/cryptoKeys/reg-sealed" }
  }

  assert {
    condition = { for s, c in output.storage.compartments : s => c.bucket } == {
      "CONFIDENTIAL.BOARD_CONFIDENTIAL" = "infrabyx-fbx-prod-conf-board"
      "CONFIDENTIAL.SEALED"             = "infrabyx-fbx-prod-conf-sealed"
      "REGULATED.BOARD_CONFIDENTIAL"    = "infrabyx-fbx-prod-reg-board"
      "REGULATED.SEALED"                = "infrabyx-fbx-prod-reg-sealed"
    }
    error_message = "each location has its own bucket, named <name>-<class>-<compartment>"
  }
  assert {
    condition     = length(setintersection(toset([for c in values(output.storage.compartments) : c.bucket]), toset(values(output.storage.buckets)))) == 0
    error_message = "no compartment bucket is a class bucket"
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

# The compartment keys, on the kms module itself (its resources are not visible from the
# platform's runs): the platform key's kind, in the multi-region ring, for the storage agent only.
run "kms_compartment_keys" {
  command = apply
  module {
    source = "../kms"
  }
  providers = {
    google = google
  }
  variables {
    name         = "infrabyx-ldc-prod"
    region       = "asia-south1"
    region_dr    = "asia-south2"
    compartments = ["CONFIDENTIAL.BOARD_CONFIDENTIAL", "REGULATED.SEALED"]
  }

  assert {
    condition = alltrue([for s, k in google_kms_crypto_key.compartment :
      k.key_ring == google_kms_key_ring.this["geo"].id && k.purpose == "ENCRYPT_DECRYPT" && k.rotation_period == "7776000s" &&
      k.version_template[0].algorithm == "GOOGLE_SYMMETRIC_ENCRYPTION" && k.version_template[0].protection_level == "HSM"
    ])
    error_message = "each compartment key is an HSM key in the multi-region ring, rotated every 90 days, like the platform key"
  }
  assert {
    condition     = google_kms_crypto_key.compartment["CONFIDENTIAL.BOARD_CONFIDENTIAL"].name == "conf-board" && google_kms_crypto_key.compartment["REGULATED.SEALED"].name == "reg-sealed"
    error_message = "each compartment key is named after its location"
  }
  assert {
    condition = alltrue([for s, m in google_kms_crypto_key_iam_member.compartment_storage :
      m.member == "serviceAccount:service-123456789012@gs-project-accounts.iam.gserviceaccount.com" && m.role == "roles/cloudkms.cryptoKeyEncrypterDecrypter"
    ]) && length(google_kms_crypto_key_iam_member.compartment_storage) == 2
    error_message = "only the storage service agent may encrypt and decrypt with a compartment key"
  }
}

# The compartment buckets' controls, on the object_storage module itself.
run "object_storage_compartment_controls" {
  command = apply
  module {
    source = "../object_storage"
  }
  providers = {
    google = google
  }
  variables {
    name                = "infrabyx-ldc-prod"
    region              = "asia-south1"
    region_dr           = "asia-south2"
    key_id              = "projects/infrabyx-mock/locations/asia-south1/keyRings/infrabyx-ldc-prod-primary/cryptoKeys/platform"
    multi_region_key_id = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-ldc-prod-geo/cryptoKeys/platform"
    retention_years     = { REGULATED = 10 }
    storage_compartments = [
      { class = "CONFIDENTIAL", compartment = "BOARD_CONFIDENTIAL" },
      { class = "REGULATED", compartment = "SEALED" },
    ]
    compartment_key_ids = {
      "CONFIDENTIAL.BOARD_CONFIDENTIAL" = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-ldc-prod-geo/cryptoKeys/conf-board"
      "REGULATED.SEALED"                = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-ldc-prod-geo/cryptoKeys/reg-sealed"
    }
  }

  assert {
    condition     = output.compartments["CONFIDENTIAL.BOARD_CONFIDENTIAL"].bucket == "infrabyx-ldc-prod-conf-board" && output.compartments["REGULATED.SEALED"].bucket == "infrabyx-ldc-prod-reg-sealed"
    error_message = "compartment buckets are named <name>-<class>-<compartment>"
  }
  assert {
    condition = alltrue([for s, c in output.compartments :
      c.key_id == var.compartment_key_ids[s] && google_storage_bucket.this[s].encryption[0].default_kms_key_name == var.compartment_key_ids[s]
    ])
    error_message = "each compartment bucket is encrypted with its own key, which compartments returns"
  }
  assert {
    condition     = alltrue([for c in ["AUDIT", "REGULATED", "CONFIDENTIAL"] : google_storage_bucket.this[c].encryption[0].default_kms_key_name == var.multi_region_key_id])
    error_message = "the locked class buckets keep the platform key"
  }
  assert {
    condition = (
      google_storage_bucket.this["CONFIDENTIAL.BOARD_CONFIDENTIAL"].retention_policy[0].retention_period == "31536000" &&
      google_storage_bucket.this["REGULATED.SEALED"].retention_policy[0].retention_period == "315360000" &&
      alltrue([for s in keys(output.compartments) : google_storage_bucket.this[s].retention_policy[0].is_locked])
    )
    error_message = "each compartment bucket has its class's locked retention"
  }
  assert {
    condition = alltrue([for s in keys(output.compartments) :
      google_storage_bucket.this[s].location == "ASIA" &&
      toset(google_storage_bucket.this[s].custom_placement_config[0].data_locations) == toset(["ASIA-SOUTH1", "ASIA-SOUTH2"]) &&
      google_storage_bucket.this[s].uniform_bucket_level_access && google_storage_bucket.this[s].public_access_prevention == "enforced" &&
      google_storage_bucket.this[s].versioning[0].enabled && !google_storage_bucket.this[s].force_destroy &&
      google_storage_bucket.this[s].labels["compartment"] == lower(replace(split(".", s)[1], "_", "-"))
    ])
    error_message = "each compartment bucket is dual-region, uniform-access, public-access-prevented and versioned"
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
    google = google
  }
  variables {
    name                 = "infrabyx-ldc-prod"
    region               = "asia-south1"
    region_dr            = "asia-south2"
    key_id               = "projects/infrabyx-mock/locations/asia-south1/keyRings/infrabyx-ldc-prod-primary/cryptoKeys/platform"
    multi_region_key_id  = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-ldc-prod-geo/cryptoKeys/platform"
    retention_years      = { REGULATED = 10 }
    storage_compartments = [{ class = "CONFIDENTIAL", compartment = "SEALED" }]
    compartment_key_ids  = { "CONFIDENTIAL.SEALED" = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-ldc-prod-geo/cryptoKeys/platform" }
  }
  expect_failures = [terraform_data.compartment_keys]
}

run "object_storage_compartment_without_a_key_refused" {
  command = plan
  module {
    source = "../object_storage"
  }
  providers = {
    google = google
  }
  variables {
    name                 = "infrabyx-ldc-prod"
    region               = "asia-south1"
    region_dr            = "asia-south2"
    key_id               = "projects/infrabyx-mock/locations/asia-south1/keyRings/infrabyx-ldc-prod-primary/cryptoKeys/platform"
    multi_region_key_id  = "projects/infrabyx-mock/locations/asia/keyRings/infrabyx-ldc-prod-geo/cryptoKeys/platform"
    retention_years      = { REGULATED = 10 }
    storage_compartments = [{ class = "REGULATED", compartment = "BOARD_CONFIDENTIAL" }]
  }
  expect_failures = [var.compartment_key_ids]
}


run "kms_unknown_compartment_refused" {
  command = plan
  module {
    source = "../kms"
  }
  providers = {
    google = google
  }
  variables {
    name         = "infrabyx-ldc-prod"
    region       = "asia-south1"
    region_dr    = "asia-south2"
    compartments = ["CONFIDENTIAL.PRIVATE"]
  }
  expect_failures = [var.compartments]
}
