output "cluster_id" {
  value = azurerm_kubernetes_cluster.this.id
}

output "oidc_issuer" {
  value = azurerm_kubernetes_cluster.this.oidc_issuer_url
}

output "kubelet_object_id" {
  value = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}

# Written by the bootstrap after the cluster exists; see the secrets module.
output "kubeconfig_ref" {
  value = "${var.secrets_path_prefix}-k8s-kubeconfig"
}
