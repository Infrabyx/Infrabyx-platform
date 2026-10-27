# GKE, regional (IPB-01 §01.4.9.1): private nodes and a private endpoint unless admin_cidrs is
# set, master authorized networks, Workload Identity, secrets envelope-encrypted with the platform
# key, network policy (the chart's default-deny), Binary Authorization, shielded COS nodes with
# the GKE metadata server and no legacy endpoints, a dedicated node service account, and the
# control-plane logs.
data "google_client_config" "this" {}

locals {
  project = data.google_client_config.this.project
  short   = replace(var.name, "infrabyx-", "ibx-")
}

resource "google_service_account" "nodes" {
  account_id   = "${local.short}-nodes"
  display_name = "GKE nodes (${var.name})"
}

resource "google_project_iam_member" "nodes" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
    "roles/artifactregistry.reader",
  ])
  project = local.project
  role    = each.key
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

resource "google_container_cluster" "this" {
  name                     = var.name
  location                 = var.region
  network                  = var.network_id
  subnetwork               = var.subnet_id
  networking_mode          = "VPC_NATIVE"
  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = true
  enable_shielded_nodes    = true
  enable_legacy_abac       = false
  resource_labels          = var.tags

  release_channel {
    channel = "STABLE"
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = length(var.admin_cidrs) == 0
    master_ipv4_cidr_block  = var.master_cidr
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.admin_cidrs
      content {
        cidr_block   = cidr_blocks.value
        display_name = "admin"
      }
    }
  }

  network_policy {
    enabled  = true
    provider = "CALICO"
  }

  addons_config {
    network_policy_config {
      disabled = false
    }
  }

  workload_identity_config {
    workload_pool = "${local.project}.svc.id.goog"
  }

  database_encryption {
    state    = "ENCRYPTED"
    key_name = var.key_id
  }

  master_auth {
    client_certificate_config {
      issue_client_certificate = false
    }
  }

  binary_authorization {
    evaluation_mode = "PROJECT_SINGLETON_POLICY_ENFORCE"
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "APISERVER", "CONTROLLER_MANAGER", "SCHEDULER", "WORKLOADS"]
  }
}

resource "google_container_node_pool" "default" {
  name           = "default"
  cluster        = google_container_cluster.this.id
  location       = var.region
  node_locations = var.zones
  autoscaling {
    total_min_node_count = 3
    total_max_node_count = 9
    location_policy      = "BALANCED"
  }
  management {
    auto_repair  = true
    auto_upgrade = true
  }
  upgrade_settings {
    max_surge       = 1
    max_unavailable = 0
  }
  node_config {
    machine_type      = var.machine_type
    image_type        = "COS_CONTAINERD"
    disk_type         = "pd-balanced"
    disk_size_gb      = 100
    boot_disk_kms_key = var.key_id
    service_account   = google_service_account.nodes.email
    oauth_scopes      = ["https://www.googleapis.com/auth/cloud-platform"]
    metadata          = { disable-legacy-endpoints = "true" }
    labels            = var.tags
    workload_metadata_config {
      mode = "GKE_METADATA"
    }
    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }
  }
}
