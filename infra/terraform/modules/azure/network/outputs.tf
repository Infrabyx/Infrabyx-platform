output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

output "cidr" {
  value = var.cidr
}

output "nodes_subnet_id" {
  value = azurerm_subnet.nodes.id
}

output "postgres_subnet_id" {
  value = azurerm_subnet.postgres.id
}

output "endpoints_subnet_id" {
  value = azurerm_subnet.endpoints.id
}

output "bastion_subnet_id" {
  value = azurerm_subnet.bastion.id
}
