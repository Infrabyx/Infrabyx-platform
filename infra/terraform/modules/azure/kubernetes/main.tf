# AKS (IPB-01 §01.4.9.1): a private API server unless admin_cidrs is set, local accounts off and
# Entra ID with Azure RBAC, workload identity through the OIDC issuer, the Key Vault CSI driver
# the chart's SecretProviderClass uses, Cilium network policy (the chart's default-deny), nodes
# across three zones with encryption at host, and the control-plane logs in a workspace.
locals {
  short = replace(var.name, "infrabyx-", "ibx-")
}

resource "azurerm_user_assigned_identity" "cluster" {
  name                = "${var.name}-aks"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

# The nodes' own identity (image pulls); the cluster identity may assign it to the nodes.
resource "azurerm_user_assigned_identity" "kubelet" {
  name                = "${var.name}-kubelet"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_role_assignment" "kubelet_operator" {
  scope                = azurerm_user_assigned_identity.kubelet.id
  role_definition_name = "Managed Identity Operator"
  principal_id         = azurerm_user_assigned_identity.cluster.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "network" {
  scope                = var.subnet_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_user_assigned_identity.cluster.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_log_analytics_workspace" "this" {
  name                = "${var.name}-aks"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = var.tags
}

resource "azurerm_kubernetes_cluster" "this" {
  name                              = var.name
  location                          = var.location
  resource_group_name               = var.resource_group_name
  dns_prefix                        = local.short
  kubernetes_version                = var.kubernetes_version
  sku_tier                          = "Standard"
  private_cluster_enabled           = length(var.admin_cidrs) == 0
  local_account_disabled            = true
  role_based_access_control_enabled = true
  oidc_issuer_enabled               = true
  workload_identity_enabled         = true
  azure_policy_enabled              = true
  automatic_upgrade_channel         = "patch"
  node_os_upgrade_channel           = "NodeImage"
  image_cleaner_enabled             = true
  image_cleaner_interval_hours      = 48

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled = true
    tenant_id          = var.tenant_id
  }

  dynamic "api_server_access_profile" {
    for_each = length(var.admin_cidrs) > 0 ? [1] : []
    content {
      authorized_ip_ranges = var.admin_cidrs
    }
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.cluster.id]
  }

  kubelet_identity {
    client_id                 = azurerm_user_assigned_identity.kubelet.client_id
    object_id                 = azurerm_user_assigned_identity.kubelet.principal_id
    user_assigned_identity_id = azurerm_user_assigned_identity.kubelet.id
  }

  # Nodes come from the autoscaled default pool, not node auto-provisioning.
  node_provisioning_profile {
    mode = "Manual"
  }

  default_node_pool {
    name                        = "system"
    temporary_name_for_rotation = "systemtmp"
    vm_size                     = var.node_vm_size
    vnet_subnet_id              = var.subnet_id
    zones                       = var.zones
    auto_scaling_enabled        = true
    min_count                   = 3
    max_count                   = 6
    host_encryption_enabled     = true
    os_sku                      = "AzureLinux"
    upgrade_settings {
      max_surge = "33%"
    }
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_data_plane  = "cilium"
    network_policy      = "cilium"
    pod_cidr            = "10.244.0.0/16"
    service_cidr        = "10.21.0.0/16"
    dns_service_ip      = "10.21.0.10"
    load_balancer_sku   = "standard"
    outbound_type       = "loadBalancer"
  }

  key_vault_secrets_provider {
    secret_rotation_enabled = true
  }

  oms_agent {
    log_analytics_workspace_id      = azurerm_log_analytics_workspace.this.id
    msi_auth_for_monitoring_enabled = true
  }

  tags       = var.tags
  depends_on = [azurerm_role_assignment.network, azurerm_role_assignment.kubelet_operator]
}

resource "azurerm_monitor_diagnostic_setting" "control_plane" {
  name                       = "control-plane"
  target_resource_id         = azurerm_kubernetes_cluster.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  dynamic "enabled_log" {
    for_each = ["kube-apiserver", "kube-audit-admin", "kube-controller-manager", "kube-scheduler", "guard"]
    content {
      category = enabled_log.value
    }
  }
}
