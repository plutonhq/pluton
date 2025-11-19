/**
 * @plutonhq/core-frontend
 * Main library entry point
 *
 * This file only exports types. For better organization and IDE auto-complete:
 * - Import components from '@plutonhq/core-frontend/components'
 * - Import services from '@plutonhq/core-frontend/services'
 * - Import hooks from '@plutonhq/core-frontend/hooks'
 * - Import utils from '@plutonhq/core-frontend/utils'
 * - Import contexts from '@plutonhq/core-frontend/context'
 * - Import routes from '@plutonhq/core-frontend/routes'
 * - Import router from '@plutonhq/core-frontend/router'
 */

// Export all types under a namespace to avoid conflicts with components
import * as PlutoTypes from './@types/index';
export { PlutoTypes as Types };

// Also export types directly for type-only imports
export type * from './@types/backups';
export type * from './@types/devices';
export type * from './@types/plans';
export type * from './@types/restores';
export type * from './@types/settings';
export type * from './@types/storages';
export type * from './@types/system';
