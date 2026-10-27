# Memorystore for Redis 7.2, Standard tier with a replica in a second zone (IPB-01 §01.4.9.1):
# private service access only, TLS with server authentication, AUTH required, and the platform
# key. Memorystore generates the AUTH string, so it is in state (state is SECRET class, PL6-D-06);
# the bootstrap copies it into the redis-url secret.
resource "google_redis_instance" "this" {
  name                    = var.name
  region                  = var.region
  location_id             = var.zones[0]
  alternative_location_id = var.zones[1]
  tier                    = "STANDARD_HA"
  memory_size_gb          = var.memory_size_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = var.network_id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  customer_managed_key    = var.key_id
  replica_count           = 1
  read_replicas_mode      = "READ_REPLICAS_ENABLED"
  labels                  = var.tags
}
