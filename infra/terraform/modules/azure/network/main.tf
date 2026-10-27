# One virtual network per environment: the node subnet (pods use the Azure CNI overlay, so they
# take no subnet addresses), a subnet delegated to PostgreSQL Flexible Server, one for private
# endpoints and the Bastion subnet that the break-glass path uses (IPB-01 §01.4.9.1).
resource "azurerm_virtual_network" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = [var.cidr]
  tags                = var.tags
}

resource "azurerm_subnet" "nodes" {
  name                 = "nodes"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [cidrsubnet(var.cidr, 4, 0)]
  # The storage accounts and key vaults admit this subnet and nothing else.
  dynamic "service_endpoint" {
    for_each = ["Microsoft.Storage", "Microsoft.KeyVault", "Microsoft.ContainerRegistry"]
    content {
      service = service_endpoint.value
    }
  }
}

resource "azurerm_subnet" "postgres" {
  name                 = "postgres"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [cidrsubnet(var.cidr, 8, 16)]
  delegation {
    name = "postgres"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "endpoints" {
  name                 = "endpoints"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [cidrsubnet(var.cidr, 8, 17)]
}

resource "azurerm_subnet" "bastion" {
  name                 = "AzureBastionSubnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [cidrsubnet(var.cidr, 10, 72)]
}

# Nothing reaches the nodes from the internet: inbound traffic comes through the load balancer
# rules AKS manages, and the default rules deny the rest.
resource "azurerm_network_security_group" "nodes" {
  name                = "${var.name}-nodes"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_subnet_network_security_group_association" "nodes" {
  subnet_id                 = azurerm_subnet.nodes.id
  network_security_group_id = azurerm_network_security_group.nodes.id
}
