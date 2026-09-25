import { z } from "zod";

export const localizedNameSchema = z.looseObject({
  ja: z.string().optional(),
  en: z.string().optional(),
});
export type LocalizedName = z.infer<typeof localizedNameSchema>;

export const additionalPropertySchema = z.looseObject({
  name: z.string(),
  value: z.string(),
});
export type AdditionalProperty = z.infer<typeof additionalPropertySchema>;

export const scheduleIndexEntrySchema = z.looseObject({
  branchCode: z.string(),
  availabilityStarts: z.string().optional(),
  availabilityStartsToMembers: z.string().optional(),
});
export type ScheduleIndexEntry = z.infer<typeof scheduleIndexEntrySchema>;

export const scheduleIndexSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), z.array(scheduleIndexEntrySchema))),
  ),
);
export type ScheduleIndex = z.infer<typeof scheduleIndexSchema>;

export const roomSchema = z.looseObject({
  branchCode: z.string(),
  name: localizedNameSchema,
  address: localizedNameSchema.optional(),
  additionalProperty: z.array(additionalPropertySchema).optional(),
});
export type Room = z.infer<typeof roomSchema>;

export const theaterSchema = z.looseObject({
  branchCode: z.string(),
  name: localizedNameSchema,
  rooms: z.record(z.string(), roomSchema).optional(),
  additionalProperty: z.array(additionalPropertySchema).optional(),
});
export type Theater = z.infer<typeof theaterSchema>;

export const theatersSchema = z.record(z.string(), theaterSchema);
export type TheaterIndex = z.infer<typeof theatersSchema>;

export const maintenanceSchema = z.record(z.string(), z.looseObject({}));
export type MaintenanceInfo = z.infer<typeof maintenanceSchema>;

export const offersSchema = z.looseObject({
  availabilityStarts: z.string().optional(),
  availabilityStartsToMembers: z.string().optional(),
  validFrom: z.string().optional(),
  validFromForMembers: z.string().optional(),
  validThrough: z.string().optional(),
  validThroughForMembers: z.string().optional(),
  isOnlyWindowSale: z.boolean().optional(),
});
export type Offers = z.infer<typeof offersSchema>;

export const dayEntrySchema = z.looseObject({
  id: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  location: z.looseObject({
    branchCode: z.string(),
    name: localizedNameSchema,
  }),
  maximumAttendeeCapacity: z.number().optional(),
  remainingAttendeeCapacity: z.number().optional(),
  smartTheaterNo: z.string().optional(),
  name: localizedNameSchema,
  description: localizedNameSchema.optional(),
  theaterName: localizedNameSchema.optional(),
  offers: offersSchema.optional(),
  workPerformed: z.looseObject({ duration: z.string().optional() }).optional(),
  superEvent: z
    .looseObject({
      id: z.string(),
      description: localizedNameSchema.optional(),
    })
    .optional(),
  additionalProperty: z.array(additionalPropertySchema).optional(),
});
export type DayEntry = z.infer<typeof dayEntrySchema>;

export const dayScheduleSchema = z.record(z.string(), z.record(z.string(), dayEntrySchema));
export type DaySchedule = z.infer<typeof dayScheduleSchema>;
