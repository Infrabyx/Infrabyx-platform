# Break-glass (IPB-02): off by default. When enabled, the named Entra groups get cluster
# administration through Azure RBAC on the AKS cluster, behind the tenant's MFA Conditional
# Access; no bastion host, no SSH. Time-bound elevation is Entra PIM, outside OpenTofu.
resource "azurerm_role_assignment" "this" {
  for_each             = var.enabled ? var.principal_ids : {}
  scope                = var.cluster_id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = each.value
  principal_type       = "Group"
  description          = "Break-glass (${var.name}); remove after the incident"
}
