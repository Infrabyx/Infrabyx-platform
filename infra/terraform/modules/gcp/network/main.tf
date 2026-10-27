# One VPC per environment (IPB-01 §01.4.9.1): the node subnet with the pod and service ranges
# (VPC-native GKE), Private Google Access and flow logs; private service access for Cloud SQL
# and Memorystore; Cloud NAT for egress, so no node has a public address. GCP denies all ingress
# by default and this module adds no rule that opens it.
resource "google_compute_network" "this" {
  name                    = var.name
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "nodes" {
  name                     = "${var.name}-nodes"
  region                   = var.region
  network                  = google_compute_network.this.id
  ip_cidr_range            = var.cidr
  private_ip_google_access = true
  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = var.pods_cidr
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = var.services_cidr
  }
  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_global_address" "services" {
  name          = "${var.name}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.this.id
}

resource "google_service_networking_connection" "this" {
  network                 = google_compute_network.this.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.services.name]
}

resource "google_compute_router" "this" {
  name    = var.name
  region  = var.region
  network = google_compute_network.this.id
}

resource "google_compute_router_nat" "this" {
  name                               = var.name
  router                             = google_compute_router.this.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
