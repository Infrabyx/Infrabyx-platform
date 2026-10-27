output "network_id" {
  value = google_compute_network.this.id
}

output "nodes_subnet_id" {
  value = google_compute_subnetwork.nodes.id
}

output "cidr" {
  value = var.cidr
}

# Cloud SQL and Memorystore need the peering before they are created.
output "private_service_connection" {
  value = google_service_networking_connection.this.id
}
