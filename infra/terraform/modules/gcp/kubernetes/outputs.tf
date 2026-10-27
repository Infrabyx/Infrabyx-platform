output "cluster_id" {
  value = google_container_cluster.this.id
}

output "workload_pool" {
  value = "${local.project}.svc.id.goog"
}

# Written by the bootstrap after the cluster exists; see the secrets module.
output "kubeconfig_ref" {
  value = "${var.secrets_path_prefix}-k8s-kubeconfig"
}
